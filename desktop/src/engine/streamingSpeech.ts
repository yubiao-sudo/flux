import { convertFileSrc } from '@tauri-apps/api/core';
import { getTtsConfig, synthesizeTts } from './api';
import { cleanForSpeech, dispatchTtsPulse, dispatchTtsState } from './voiceReactive';

/**
 * Speak the reply while it is being generated.
 *
 * The old path waited for `engine.send()` to resolve, extracted a hand-picked
 * "monologue" (dropping lists, tables and clipped at 600 chars) and spoke that.
 * The result was a voice track that had little to do with the transcript.
 *
 * This queue consumes the same `engine.streaming` string the transcript shows,
 * cuts it at sentence boundaries and speaks each sentence in order. Nothing is
 * dropped except Markdown syntax that cannot be pronounced (code fences become
 * 「代码略」), so spoken content follows the visible reply.
 */
const END_OF_SENTENCE = /[。！？!?；;…\n]/;

/**
 * 给正在播放的语音接一个频谱分析器，按真实能量回调。
 *
 * 浏览器语音（speechSynthesis）拿不到音频流，只有云 TTS 的 <audio> 可以接
 * MediaElementSource → AnalyserNode。返回一个 detach 用于停止 rAF 并断连。
 *
 * 共享一个 AudioContext：每个 <audio> 都 new 一个会把设备句柄吃满。
 */
let ttsCtx: AudioContext | null = null;
function attachTtsAnalyser(
  player: HTMLAudioElement,
  onEnergy: (energy: number) => void,
): () => void {
  try {
    if (!ttsCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return () => {};
      ttsCtx = new Ctor();
    }
    if (ttsCtx.state === 'suspended') void ttsCtx.resume().catch(() => {});
    const ctx = ttsCtx;
    const source = ctx.createMediaElementSource(player);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    let last = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) sum += data[i];
      const energy = Math.min(1, (sum / data.length / 255) * 3.2);
      const now = performance.now();
      if (energy > 0.1 && now - last > 80) {
        last = now;
        onEnergy(Math.max(0.42, energy));
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      try {
        source.disconnect();
        analyser.disconnect();
      } catch {
        /* 已断开 */
      }
    };
  } catch {
    // AudioContext 不可用：保留静音播放，只是没有频谱律动
    return () => {};
  }
}


function stripCards(text: string) {
  return text
    .replace(/```chat_card[\s\S]*?```/gi, '')
    .replace(/```(?:acui|card)[\s\S]*?```/gi, '')
    .trim();
}

export type StreamingSpeech = {
  begin: () => void;
  /**
   * 提交瞬间的本地确认语：不经过模型，也不进入最终回复的流式队列。
   * 它和正式回复共用 TTS 音色，但正式回复的第一句会排在它后面，
   * 不会因为 `push()` 检测到新文本而把它截断。
   */
  ack: (text: string) => void;
  push: (text: string) => void;
  finish: () => void;
  reset: () => void;
  pause: () => void;
  resume: () => void;
  isActive: () => boolean;
};

export function createStreamingSpeech(opts: {
  onStart?: () => void;
  onEnd?: () => void;
  /** 确认语播完、正式回复还没开口时，让调用方把状态从「回应」切回「推演」。 */
  onAckEnd?: () => void;
  /**
   * 语音读到哪里了（字符数，相对整段回复）。
   *
   * 作用：让**文字跟声音同步**。调用方据此只显示前 N 个字，
   * 于是字随朗读一个个出来，而不是一次性砸出来让声音在后面追。
   * 云 TTS 用音频播放进度换算；浏览器语音用 boundary 事件的 charIndex。
   */
  onProgress?: (spokenChars: number) => void;
} = {}): StreamingSpeech {
  let generation = 0;
  let full = '';
  let carry = '';
  // 每句带上它在 full 里的起始位置，progress 才能换算成"整段读到第几个字"
  let queue: { text: string; start: number }[] = [];
  // 往 full 里搜句子位置时用的游标，避免重复匹配到前面的同名短句
  let searchFrom = 0;
  let streamOpen = false;
  let speaking = false;
  let started = false;
  let paused = false;
  // 提交瞬间的确认语独立于正式回复队列。正式回复到来时只重置主队列，
  // 不能把还在播放的 ack 一起停掉，否则「即时反馈」会被下一轮 token 截断。
  let ackPlaying = false;
  let ackSerial = 0;
  // 正式回复是否已经开过口。ack 也会触发 onStart，因此不能只看 `started`，
  // 否则确认语播完回到「推演」后，正式回复第一句会被误判为已经开过口。
  let mainStarted = false;

  const progress = (chars: number) => {
    try {
      opts.onProgress?.(Math.max(0, Math.round(chars)));
    } catch {
      /* 回调不应该影响朗读 */
    }
  };
  // A playback generation. Every start/cancel bumps it so a late `ended`
  // callback from an older clip can never start a second pump in parallel.
  let playSerial = 0;

  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  let config: Awaited<ReturnType<typeof getTtsConfig>> | null = null;
  let configAttempt = 0;
  let configSettled = false;
  let configWait: Promise<void> | null = null;
  let waitingForConfig = false;
  let audio: HTMLAudioElement | null = null;
  let audioPulse = 0;
  let ackAudio: HTMLAudioElement | null = null;
  let ackDetach: (() => void) | null = null;
  let prefetch: { text: string; src: string } | null = null;
  let prefetching = false;
  // Small LRU of synthesised clips. Kokoro's cold model load is seconds, but
  // repeated short lines ("好。", "我在。", status phrases) become instant.
  const audioCache = new Map<string, string>();
  const MAX_AUDIO_CACHE = 24;
  const voiceKey = () =>
    `${config?.provider ?? 'local'}|${config?.voice ?? ''}|${config?.model ?? ''}`;
  const cacheGet = (text: string) => audioCache.get(`${voiceKey()}|${text}`) ?? null;
  const cacheSet = (text: string, src: string) => {
    if (!src) return;
    const key = `${voiceKey()}|${text}`;
    audioCache.delete(key);
    audioCache.set(key, src);
    while (audioCache.size > MAX_AUDIO_CACHE) {
      const oldest = audioCache.keys().next().value;
      if (!oldest) break;
      audioCache.delete(oldest);
    }
  };

  const stopAudio = () => {
    if (audioPulse) {
      window.clearInterval(audioPulse);
      audioPulse = 0;
    }
    if (!audio) return;
    const current = audio;
    audio = null;
    current.onended = null;
    current.onerror = null;
    try {
      current.pause();
      current.currentTime = 0;
    } catch {
      /* already detached */
    }
  };

  const stopAckAudio = () => {
    if (ackDetach) {
      ackDetach();
      ackDetach = null;
    }
    if (!ackAudio) return;
    const current = ackAudio;
    ackAudio = null;
    current.onended = null;
    current.onerror = null;
    try {
      current.pause();
      current.currentTime = 0;
    } catch {
      /* already detached */
    }
  };

  const stopPlayback = (preserveAck = false) => {
    playSerial += 1;
    // ack 正在播放时，正式回复的新一轮文本不能让 synth.cancel() 把它一起掐掉。
    if (synth && !(preserveAck && ackPlaying)) synth.cancel();
    stopAudio();
    prefetch = null;
    prefetching = false;
    paused = false;
  };

  /** 暂停当前句：浏览器语音用 speechSynthesis.pause，云端音频用 <audio>.pause。 */
  const pause = () => {
    paused = true;
    try {
      if (ackAudio) {
        ackAudio.pause();
      } else if (audio) {
        audio.pause();
      } else if (synth && synth.speaking) {
        synth.pause();
      }
    } catch {
      /* 某些 WebView 不支持 pause，忽略即可 */
    }
  };

  const resume = () => {
    paused = false;
    try {
      if (ackAudio) {
        if (ackAudio.paused) void ackAudio.play().catch(() => undefined);
      } else if (audio) {
        if (audio.paused) void audio.play().catch(() => undefined);
      } else if (synth && synth.paused) {
        synth.resume();
      } else if (!speaking && !ackPlaying && queue.length > 0) {
        pump();
      }
    } catch {
      /* 同 pause */
    }
  };

  const refreshConfig = () => {
    const attempt = ++configAttempt;
    configSettled = false;
    configWait = getTtsConfig()
      .then((next) => {
        if (attempt === configAttempt) config = next;
      })
      .catch(() => {
        /* keep the previous / local voice */
      })
      .finally(() => {
        if (attempt === configAttempt) configSettled = true;
      });
    return configWait;
  };
  refreshConfig();

  const finishCycle = () => {
    if (started) {
      dispatchTtsState(false);
      opts.onEnd?.();
    }
    started = false;
    mainStarted = false;
  };

  const settle = (token: number, serial: number) => {
    if (token !== generation || serial !== playSerial) return;
    speaking = false;
    if (queue.length > 0) {
      pump();
    } else if (!streamOpen) {
      finishCycle();
    }
  };

  // Synthesise the next sentence while the current clip is still playing.
  // Without this, every cloud/Doubao/Kokoro sentence pays the full network
  // round-trip after the previous clip ends, which sounds like a long pause.
  const warmNext = (token: number) => {
    if (prefetch || prefetching) return;
    const next = queue[0];
    if (!next) return;
    const text = cleanForSpeech(next.text);
    if (!text || text.length < 2) return;
    const cached = cacheGet(text);
    if (cached) {
      prefetch = { text, src: cached };
      return;
    }
    prefetching = true;
    synthesizeTts(text)
      .then((src) => {
        if (token === generation && src) {
          cacheSet(text, src);
          prefetch = { text, src };
        }
      })
      .catch(() => {
        /* prefetch is an optimisation; the normal path will retry */
      })
      .finally(() => {
        prefetching = false;
      });
  };

  function pump() {
    // ack 是「开口确认」，正式回复必须排在它后面；否则两个声音会叠在一起。
    if (speaking || ackPlaying) return;
    // Never let the first sentence use the browser voice just because the
    // saved provider (Doubao / Kokoro / cloud) is still loading. A reply must
    // use one voice from the first word to the last.
    if (!configSettled) {
      if (!waitingForConfig) {
        waitingForConfig = true;
        const token = generation;
        void (configWait ?? refreshConfig()).finally(() => {
          waitingForConfig = false;
          if (token === generation) pump();
        });
      }
      return;
    }
    while (queue.length > 0) {
      const next = queue.shift()!;
      const text = cleanForSpeech(next.text);
      if (!text || text.length < 2) continue;
      speaking = true;
      const serial = ++playSerial;
      if (!mainStarted) {
        mainStarted = true;
        started = true;
        dispatchTtsState(true);
        opts.onStart?.();
      }
      const token = generation;
      const cloud = Boolean(config && config.provider && config.provider !== 'local');

      if (cloud) {
        void (async () => {
          try {
            const prefetched = prefetch?.text === text ? prefetch.src : null;
            if (prefetch?.text === text) prefetch = null;
            const remembered = cacheGet(text);
            const src = prefetched || remembered || (await synthesizeTts(text));
            if (token !== generation || serial !== playSerial) return;
            if (!src) throw new Error('empty cloud audio path');
            cacheSet(text, src);
            stopAudio();
            await new Promise<void>((resolve) => {
              const player = new Audio(
                src.startsWith('data:') ? src : convertFileSrc(src),
              );
              audio = player;
              let settled = false;
              const detach = attachTtsAnalyser(player, (energy) =>
                dispatchTtsPulse(energy),
              );
              const done = () => {
                if (settled) return;
                settled = true;
                detach();
                if (audio === player) audio = null;
                if (audioPulse) {
                  window.clearInterval(audioPulse);
                  audioPulse = 0;
                }
                resolve();
              };
              player.onended = done;
              player.onerror = done;
              // 句子一开口，文字就跟到这句的起点
              progress(next.start);
              player.ontimeupdate = () => {
                const span = player.duration;
                if (!Number.isFinite(span) || span <= 0) return;
                const ratio = Math.min(1, player.currentTime / span);
                progress(next.start + ratio * next.text.length);
              };
              void player.play().catch(done);
              warmNext(token);
              // 这里原来还有一个「每 130ms 发一个随机脉冲」的定时器。
              // 真实频谱分析接上之后它就是噪声源（会盖掉 AnalyserNode 的真实能量），
              // 所以去掉；脉冲完全由 attachTtsAnalyser 根据音频频谱发出。
            });
          } catch {
            /* cloud sentence failed; keep the text queue moving */
          }
          settle(token, serial);
        })();
      } else if (synth) {
        // One engine at a time: never leave a cloud clip playing under the
        // browser voice. Do not cancel() here: the previous utterance has
        // already ended (pump() only runs after settle), and cancel() fires its
        // onerror asynchronously, which could start the next sentence twice.
        stopAudio();
        const utterance = new SpeechSynthesisUtterance(text);
        const savedVoice =
          config && config.provider === 'local' && config.voice
            ? synth.getVoices().find((voice) => voice.name === config?.voice) ?? null
            : null;
        if (savedVoice) utterance.voice = savedVoice;
        utterance.lang = savedVoice?.lang || 'zh-CN';
        utterance.rate = 0.94;
        utterance.pitch = 0.9;
        utterance.volume = 0.72;
        // 浏览器语音拿不到音频，但 boundary 事件本身就是真实语速：
        // 相邻两次 boundary 的字符差 ≈ 刚读出的词有多长，据此给能量，
        // 于是流体的起伏跟着"字"走，而不是随机数。
        let lastChar = 0;
        utterance.onboundary = (event) => {
          const charIndex =
            typeof event.charIndex === 'number' ? event.charIndex : lastChar;
          const delta = Math.max(1, charIndex - lastChar);
          lastChar = charIndex;
          dispatchTtsPulse(Math.min(1, 0.46 + delta * 0.09));
          progress(next.start + charIndex);
        };
        progress(next.start);
        utterance.onend = () => {
          progress(next.start + next.text.length);
          settle(token, serial);
        };
        utterance.onerror = () => settle(token, serial);
        synth.speak(utterance);
      } else {
        speaking = false;
        continue;
      }
      return;
    }
    if (!streamOpen) finishCycle();
  }

  const reset = () => {
    generation += 1;
    ackSerial += 1;
    ackPlaying = false;
    stopAckAudio();
    full = '';
    carry = '';
    queue = [];
    searchFrom = 0;
    streamOpen = false;
    speaking = false;
    waitingForConfig = false;
    stopPlayback();
    dispatchTtsState(false);
    started = false;
    mainStarted = false;
  };

  const begin = () => {
    reset();
    refreshConfig();
    streamOpen = true;
  };

  const push = (text: string) => {
    if (!text) return;
    const safe = stripCards(text);
    if (!safe) return;
    // A new model round starts with an empty or unrelated string.
    if (!safe.startsWith(full)) {
      full = '';
      carry = '';
      queue = [];
      searchFrom = 0;
      // 新一轮正式回复只重置主队列；正在播的「好的，我先看一下」继续说完。
      stopPlayback(ackPlaying);
      speaking = false;
      mainStarted = false;
      if (!ackPlaying) started = false;
    }
    streamOpen = true;
    carry += safe.slice(full.length);
    full = safe;

    let cut = -1;
    let soft = -1;
    for (let i = 0; i < carry.length; i += 1) {
      if (END_OF_SENTENCE.test(carry[i])) cut = i;
      else if ('，、,：:'.includes(carry[i])) soft = i;
    }
    // A clause is a valid speech unit. Waiting for a full stop after a long
    // comma-separated clause makes the voice lag several seconds behind the
    // text; split at the last comma once the clause has enough substance.
    if (cut < 0 && soft >= 0 && soft >= 30) cut = soft;
    // Only flush complete sentences, but don't let a long paragraph wait for
    // punctuation the model may never emit (e.g. a single long line).
    if (cut >= 0 || carry.length > 180) {
      const ready = cut >= 0 ? carry.slice(0, cut + 1) : carry;
      carry = cut >= 0 ? carry.slice(cut + 1) : '';
      ready
        .split(/(?<=[。！？!?；;…\n])/)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => {
          // 在整段里定位这句话，progress 才能换算成「读到第几个字」。
          // 找不到（被 cleanForSpeech 改写过）就退化成当前游标。
          const at = full.indexOf(part, searchFrom);
          const start = at >= 0 ? at : searchFrom;
          searchFrom = start + part.length;
          queue.push({ text: part, start });
        });
    }
    pump();
  };

  const ack = (text: string) => {
    const phrase = cleanForSpeech(text);
    if (!phrase) return;

    const serial = ++ackSerial;
    if (ackPlaying) {
      stopAckAudio();
      if (synth) synth.cancel();
    }
    // 立刻占住「正在说话」的位置：即使 TTS 配置/首句合成还在路上，
    // 正式回复也不能抢在确认语前面开口。
    ackPlaying = true;

    const finishAck = () => {
      if (serial !== ackSerial) return;
      ackPlaying = false;
      ackAudio = null;
      if (ackDetach) {
        ackDetach();
        ackDetach = null;
      }
      // 确认语结束、正式回复还没排到可播的句子：先回到「推演」，
      // 不要把整个模型思考阶段都显示成「回应」。
      if (streamOpen && !speaking && queue.length === 0) {
        dispatchTtsState(false);
        opts.onAckEnd?.();
      }
      pump();
    };

    const playWithBrowser = () => {
      if (serial !== ackSerial) return;
      if (!synth) {
        finishAck();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(phrase);
      const savedVoice =
        config && config.provider === 'local' && config.voice
          ? synth.getVoices().find((voice) => voice.name === config?.voice) ?? null
          : null;
      if (savedVoice) utterance.voice = savedVoice;
      utterance.lang = savedVoice?.lang || 'zh-CN';
      utterance.rate = 0.94;
      utterance.pitch = 0.9;
      utterance.volume = 0.72;
      utterance.onend = finishAck;
      utterance.onerror = finishAck;
      if (!started) {
        started = true;
        dispatchTtsState(true);
        opts.onStart?.();
      }
      try {
        synth.speak(utterance);
      } catch {
        finishAck();
      }
    };

    const play = () => {
      if (serial !== ackSerial) return;
      const cloud = Boolean(config && config.provider && config.provider !== 'local');
      if (!cloud) {
        playWithBrowser();
        return;
      }
      void synthesizeTts(phrase)
        .then((src) => {
          if (serial !== ackSerial) return;
          if (!src) {
            playWithBrowser();
            return;
          }
          const player = new Audio(src.startsWith('data:') ? src : convertFileSrc(src));
          ackAudio = player;
          let settled = false;
          const release = () => {
            if (ackAudio === player) ackAudio = null;
            if (ackDetach) {
              ackDetach();
              ackDetach = null;
            }
          };
          const done = () => {
            if (settled) return;
            settled = true;
            release();
            finishAck();
          };
          ackDetach = attachTtsAnalyser(player, (energy) => dispatchTtsPulse(energy));
          player.onended = done;
          player.onerror = () => {
            if (settled) return;
            settled = true;
            release();
            // 云端音频失败时退回浏览器语音，至少让确认语出声。
            if (serial === ackSerial) playWithBrowser();
          };
          if (!started) {
            started = true;
            dispatchTtsState(true);
            opts.onStart?.();
          }
          void player.play().catch(() => {
            if (settled) return;
            settled = true;
            release();
            if (serial === ackSerial) playWithBrowser();
          });
        })
        .catch(() => {
          if (serial === ackSerial) playWithBrowser();
        });
    };

    if (!configSettled) {
      void (configWait ?? refreshConfig()).finally(() => {
        if (serial === ackSerial) play();
      });
    } else {
      play();
    }
  };

  const finish = () => {
    streamOpen = false;
    if (carry.trim()) {
      const tail = carry.trim();
      const at = full.indexOf(tail, searchFrom);
      const start = at >= 0 ? at : searchFrom;
      searchFrom = start + tail.length;
      queue.push({ text: tail, start });
      carry = '';
    }
    if (queue.length > 0 || speaking || ackPlaying) {
      pump();
    } else {
      finishCycle();
    }
  };

  return {
    begin,
    ack,
    push,
    finish,
    reset,
    pause,
    resume,
    isActive: () => started || speaking || ackPlaying || queue.length > 0,
  };
}
