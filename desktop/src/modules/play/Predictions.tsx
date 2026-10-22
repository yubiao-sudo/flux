import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, CircleDashed, Swords, Target, X } from 'lucide-react';
import type { LolEvent, LolOverview, LolTeam } from '../../engine/types';
import type { Pick, PlayProfile } from './playStore';
import { loadPicks, savePicks } from './playStore';

type Props = {
  profile: PlayProfile;
  overview: LolOverview | null;
  onRecord: (kind: 'games' | 'focusMinutes' | 'radio' | 'predictions' | 'correct', amount: number, xp: number) => void;
};

function TeamChip({ team }: { team: LolTeam }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="play-pick-team">
      <span className="play-pick-logo">
        {team.image && !failed ? (
          <img src={team.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        ) : (
          <b>{team.code?.slice(0, 3) || '?'}</b>
        )}
      </span>
      <strong>{team.code || team.name}</strong>
    </span>
  );
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function winnerOf(event: LolEvent) {
  const winner = event.teams.find((team) => team.outcome === 'win');
  return winner?.id || winner?.name || '';
}

export function Predictions({ profile, overview, onRecord }: Props) {
  const [picks, setPicks] = useState<Record<string, Pick>>(() => loadPicks());
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming');

  const upcoming = useMemo(
    () =>
      (overview?.events || [])
        .filter(
          (event) =>
            event.state === 'unstarted' &&
            event.teams.length >= 2 &&
            event.teams.every((team) => team.name && team.name !== 'TBD'),
        )
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        .slice(0, 10),
    [overview],
  );

  const settled = useMemo(
    () => Object.values(picks).filter((pick) => pick.settled).sort((a, b) => b.at - a.at),
    [picks],
  );

  useEffect(() => {
    if (!overview) return;
    let changed = false;
    let correctCount = 0;
    const next: Record<string, Pick> = { ...picks };
    for (const [id, pick] of Object.entries(next)) {
      if (pick.settled) continue;
      const event = overview.events.find((item) => item.id === id);
      if (!event || event.state !== 'completed') continue;
      const winner = winnerOf(event);
      const ok = Boolean(winner && (winner === pick.pick || winner === pick.team));
      next[id] = { ...pick, settled: true, correct: ok };
      changed = true;
      if (ok) correctCount += 1;
    }
    if (changed) {
      setPicks(next);
      savePicks(next);
      if (correctCount > 0) onRecord('correct', correctCount, correctCount * 30);
    }
  }, [overview, picks, onRecord]);

  const choose = (event: LolEvent, team: LolTeam) => {
    if (picks[event.id]) return;
    const next = {
      ...picks,
      [event.id]: {
        eventId: event.id,
        pick: team.id || team.name,
        team: team.name,
        at: Date.now(),
      },
    };
    setPicks(next);
    savePicks(next);
    onRecord('predictions', 1, 8);
  };

  const accuracy = profile.stats.predictions
    ? Math.round((profile.stats.correct / profile.stats.predictions) * 100)
    : 0;
  const pending = Object.values(picks).filter((pick) => !pick.settled);

  return (
    <div className="play-predict">
      <header className="play-section-head">
        <div>
          <span>FANTASY PICK'EM / REAL RESULTS</span>
          <h1>用真实赛程，做一次判断。</h1>
          <p>选你认为会赢的队伍。比赛结束后自动结算，猜中拿 XP。</p>
        </div>
        <div className="play-predict-stats">
          <span><Target size={13} /> 命中率 <strong>{accuracy}%</strong></span>
          <span><CircleDashed size={13} /> 待结算 <strong>{pending.length}</strong></span>
        </div>
      </header>

      <div className="play-predict-tabs">
        <button type="button" className={tab === 'upcoming' ? 'is-active' : ''} onClick={() => setTab('upcoming')}>
          可预测 · {upcoming.length}
        </button>
        <button type="button" className={tab === 'history' ? 'is-active' : ''} onClick={() => setTab('history')}>
          我的记录 · {settled.length}
        </button>
      </div>

      {tab === 'upcoming' && (
        <div className="play-pick-list">
          {upcoming.map((event) => {
            const pick = picks[event.id];
            const [a, b] = event.teams;
            return (
              <article className="play-pick" key={event.id}>
                <div className="play-pick-head">
                  <span>{event.league.name}</span>
                  <em>{event.tournament.name} · BO{event.bestOf}</em>
                  <small>{timeLabel(event.startTime)}</small>
                </div>
                <div className="play-pick-body">
                  {[a, b].map((team, index) => {
                    if (!team) return null;
                    const chosen = pick?.pick === (team.id || team.name);
                    return (
                      <button
                        type="button"
                        key={`${event.id}-${team.id || index}`}
                        className={`play-pick-side ${chosen ? 'is-chosen' : ''}`}
                        onClick={() => choose(event, team)}
                        disabled={Boolean(pick)}
                      >
                        <TeamChip team={team} />
                        {chosen && <Check size={14} />}
                      </button>
                    );
                  })}
                  <span className="play-pick-vs">VS</span>
                </div>
                <div className="play-pick-foot">
                  {pick ? (
                    <span className="play-pick-locked">
                      <Check size={12} /> 已选 {pick.team}，等比赛结束结算
                    </span>
                  ) : (
                    <span><Swords size={12} /> 选一个胜者</span>
                  )}
                  <em>{event.blockName || '赛程'}</em>
                </div>
              </article>
            );
          })}
          {upcoming.length === 0 && (
            <div className="play-empty">
              <Swords size={26} />
              <strong>暂时没有可预测的比赛</strong>
              <p>等赛程更新后再来，或者去赛事面板看最近赛果。</p>
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="play-pick-list">
          {settled.map((pick) => {
            const event = overview?.events.find((item) => item.id === pick.eventId);
            return (
              <article className={`play-pick play-pick--settled ${pick.correct ? 'is-correct' : 'is-wrong'}`} key={pick.eventId}>
                <div className="play-pick-head">
                  <span>{event?.league.name || '赛事'}</span>
                  <em>{event?.tournament.name || ''}</em>
                  <small>{timeLabel(new Date(pick.at).toISOString())}</small>
                </div>
                <div className="play-pick-result">
                  <span className={pick.correct ? 'is-correct' : 'is-wrong'}>
                    {pick.correct ? <Check size={14} /> : <X size={14} />}
                    {pick.correct ? '命中' : '未中'}
                  </span>
                  <strong>你选了 {pick.team}</strong>
                  {event && (
                    <em>
                      {event.teams[0]?.code || event.teams[0]?.name} {event.teams[0]?.score ?? 0} :{' '}
                      {event.teams[1]?.score ?? 0} {event.teams[1]?.code || event.teams[1]?.name}
                    </em>
                  )}
                </div>
              </article>
            );
          })}
          {settled.length === 0 && (
            <div className="play-empty">
              <Target size={26} />
              <strong>还没有结算记录</strong>
              <p>先去「可预测」选几场，比赛结束后回来看结果。</p>
            </div>
          )}
        </div>
      )}

      <footer className="play-predict-note">
        <ChevronRight size={12} /> 数据来自当前赛事面板；只有已结束且能确定胜者的比赛会结算。
      </footer>
    </div>
  );
}
