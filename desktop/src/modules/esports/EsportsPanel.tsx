import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CalendarDays,
  ChevronRight,
  Clock3,
  Crown,
  ExternalLink,
  Flame,
  Play,
  RefreshCw,
  Search,
  Swords,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import { getLolEsportsOverview, openUrlTab } from '../../engine/api';
import type { LolEvent, LolGame, LolOverview, LolTeam } from '../../engine/types';
import './esports.css';

type Tab = 'schedule' | 'standings' | 'highlights' | 'preview';

type SeasonStar = {
  key: string;
  team: LolTeam;
  league: string;
  matches: number;
  wins: number;
  rank: number;
};

const TAB_LABEL: Record<Tab, string> = {
  schedule: '赛程',
  standings: '积分',
  highlights: '高光',
  preview: '预告',
};

const TEAM_CN: Record<string, string> = {
  'Bilibili Gaming': '哔哩哔哩 BLG',
  'JD Gaming': '京东 JDG',
  'Top Esports': '滔搏 TES',
  'LNG Esports': 'LNG',
  'Weibo Gaming': '微博 WBG',
  'EDward Gaming': 'EDG',
  'Royal Never Give Up': 'RNG',
  'Anyone\'s Legend': 'AL',
  'Invictus Gaming': 'IG',
  'T1': 'T1',
  'Gen.G': 'GEN',
  'Gen.G Esports': 'GEN',
  'Hanwha Life Esports': 'HLE',
  'KT Rolster': 'KT',
  'Dplus KIA': 'DK',
  'BNK FearX': 'FOX',
  'G2 Esports': 'G2',
  'Fnatic': 'FNC',
  'MAD Lions KOI': 'MAD',
  'Team BDS': 'BDS',
  'Team Liquid': 'TL',
  'Cloud9': 'C9',
  'FlyQuest': 'FLY',
  '100 Thieves': '100T',
  'PSG Talon': 'PSG',
  'GAM Esports': 'GAM',
  'LOUD': 'LOUD',
  'paiN Gaming': 'paiN',
  'FURIA Esports': 'FURIA',
  'Movistar R7': 'R7',
  'Isurus Estral': 'ISG',
  'Team Secret': 'TS',
  'Shopify Rebellion': 'SR',
};

const LEAGUE_CN: Record<string, string> = {
  worlds: '全球总决赛',
  msi: '季中冠军赛',
  lpl: 'LPL 中国',
  lck: 'LCK 韩国',
  lec: 'LEC 欧洲',
  lcs: 'LCS 北美',
  cblol: 'CBLOL 巴西',
  lla: 'LLA 拉美',
  vcs: 'VCS 越南',
  pcs: 'PCS 太平洋',
  ljl: 'LJL 日本',
  first_stand: 'First Stand',
  emea_masters: 'EMEA 大师赛',
};

const DAY_FMT = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
});
const TIME_FMT = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const DATE_FMT = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const TEAM_CN_LOWER: Record<string, string> = Object.fromEntries(
  Object.entries(TEAM_CN).map(([key, value]) => [key.toLowerCase(), value]),
);

function teamName(team: LolTeam | { name: string }) {
  const raw = team.name || 'TBD';
  return TEAM_CN[raw] || TEAM_CN_LOWER[raw.toLowerCase()] || raw;
}

function leagueName(name: string, slug: string) {
  return LEAGUE_CN[slug] || name;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '日期待定';
  return DAY_FMT.format(d);
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return TIME_FMT.format(d);
}

function dateRange(start?: string, end?: string) {
  if (!start || !end) return '';
  return `${DATE_FMT.format(new Date(start))} — ${DATE_FMT.format(new Date(end))}`;
}

function countdown(iso: string, now: number) {
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return '待定';
  const diff = target - now;
  if (diff <= 0) return '即将开始';
  const sec = Math.floor(diff / 1000);
  const day = Math.floor(sec / 86400);
  const hour = Math.floor((sec % 86400) / 3600);
  const min = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (day > 0) return `${day} 天 ${hour} 小时`;
  if (hour > 0) return `${hour} 小时 ${min} 分`;
  return `${min} 分 ${String(s).padStart(2, '0')} 秒`;
}

function stateLabel(event: LolEvent) {
  if (event.state === 'inProgress') return 'LIVE';
  if (event.state === 'completed') return '已结束';
  return '未开始';
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function TeamLogo({
  team,
  size = 'md',
}: {
  team: { name: string; code?: string; image?: string; lightImage?: string };
  size?: 'sm' | 'md' | 'lg';
}) {
  const [failed, setFailed] = useState(false);
  const src = team.image || team.lightImage || '';
  return (
    <span className={`lol-logo lol-logo--${size}`} aria-hidden="true">
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <b>{(team.code || team.name || '?').slice(0, 3).toUpperCase()}</b>
      )}
    </span>
  );
}

function openLink(url: string) {
  void openUrlTab(url).catch(() => undefined);
}

function searchHighlights(event: LolEvent) {
  const [a, b] = event.teams;
  const query = `${a?.name || ''} vs ${b?.name || ''} ${event.tournament.name} highlights`;
  openLink(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
}

function vodLink(event: LolEvent, game?: LolGame) {
  const vod = game?.vods?.[0] || game?.recaps?.[0] || event.games.find((g) => g.vods.length)?.vods[0];
  if (vod?.parameter && /^[A-Za-z0-9_-]{11}$/.test(vod.parameter)) {
    const at = Math.floor((vod.startMillis || 0) / 1000);
    return `https://www.youtube.com/watch?v=${vod.parameter}${at > 0 ? `&t=${at}s` : ''}`;
  }
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(
    `${event.teams[0]?.name || ''} vs ${event.teams[1]?.name || ''} ${event.tournament.name} VOD`,
  )}`;
}

function leagueUrl(event: LolEvent) {
  return `https://lolesports.com/en-US/leagues/${event.league.slug || 'worlds'}`;
}

function buildStandings(events: LolEvent[]) {
  const rows = new Map<
    string,
    {
      team: LolTeam;
      wins: number;
      losses: number;
      gameWins: number;
      gameLosses: number;
      played: number;
    }
  >();
  for (const event of events) {
    if (event.state !== 'completed') continue;
    const [a, b] = event.teams;
    if (!a || !b) continue;
    for (const team of [a, b]) {
      const key = team.id || team.name;
      if (!rows.has(key)) {
        rows.set(key, {
          team,
          wins: 0,
          losses: 0,
          gameWins: 0,
          gameLosses: 0,
          played: 0,
        });
      }
    }
    const ka = a.id || a.name;
    const kb = b.id || b.name;
    const ra = rows.get(ka);
    const rb = rows.get(kb);
    if (!ra || !rb) continue;
    ra.played += 1;
    rb.played += 1;
    ra.gameWins += a.score;
    ra.gameLosses += b.score;
    rb.gameWins += b.score;
    rb.gameLosses += a.score;
    if (a.outcome === 'win') {
      ra.wins += 1;
      rb.losses += 1;
    } else if (b.outcome === 'win') {
      rb.wins += 1;
      ra.losses += 1;
    }
  }
  return [...rows.values()]
    .filter((row) => row.played > 0)
    .sort((x, y) => {
      const wr = y.wins / Math.max(1, y.played) - x.wins / Math.max(1, x.played);
      if (Math.abs(wr) > 0.0001) return wr;
      const gd = y.gameWins - y.gameLosses - (x.gameWins - x.gameLosses);
      if (gd !== 0) return gd;
      return teamName(x.team).localeCompare(teamName(y.team), 'zh-CN');
    });
}

function MatchRow({
  event,
  selected,
  onSelect,
}: {
  event: LolEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  const [a, b] = event.teams;
  const live = event.state === 'inProgress';
  return (
    <button
      type="button"
      className={`lol-match ${live ? 'is-live' : ''} ${
        event.state === 'completed' ? 'is-done' : ''
      } ${selected ? 'is-selected' : ''}`}
      onClick={onSelect}
    >
      <div className="lol-match-when">
        <strong>{timeLabel(event.startTime)}</strong>
        <span>{stateLabel(event)}</span>
      </div>
      <div className="lol-match-team">
        {a ? <TeamLogo team={a} size="sm" /> : <span className="lol-logo lol-logo--sm" />}
        <div>
          <strong>{a ? teamName(a) : 'TBD'}</strong>
          <small>{a?.code || 'TBD'}</small>
        </div>
      </div>
      <div className="lol-match-score">
        {event.state === 'unstarted' ? (
          <em>VS</em>
        ) : (
          <b>
            {a?.score ?? 0}
            <i>:</i>
            {b?.score ?? 0}
          </b>
        )}
        <span>BO{event.bestOf || 1}</span>
      </div>
      <div className="lol-match-team lol-match-team--right">
        <div>
          <strong>{b ? teamName(b) : 'TBD'}</strong>
          <small>{b?.code || 'TBD'}</small>
        </div>
        {b ? <TeamLogo team={b} size="sm" /> : <span className="lol-logo lol-logo--sm" />}
      </div>
      <div className="lol-match-extra">
        <span>{event.blockName || '赛程'}</span>
        {live && <i className="lol-live-pill">LIVE</i>}
        <ChevronRight size={14} strokeWidth={1.4} />
      </div>
    </button>
  );
}

function MatchDetail({
  event,
  now,
  onOpen,
  onSearch,
}: {
  event?: LolEvent;
  now: number;
  onOpen: (url: string) => void;
  onSearch: (event: LolEvent) => void;
}) {
  if (!event) {
    return (
      <div className="lol-detail lol-detail--empty">
        <Trophy size={30} strokeWidth={1.1} />
        <span>MATCH CENTER</span>
        <h3>选择一场比赛</h3>
        <p>左侧赛程里点任意一场，查看比分、局数、回放与官方入口。</p>
      </div>
    );
  }
  const [a, b] = event.teams;
  const live = event.state === 'inProgress';
  return (
    <div className="lol-detail">
      <div className="lol-detail-bg" aria-hidden="true">
        {event.teams
          .filter((team) => team.image && team.name !== 'TBD')
          .slice(0, 2)
          .map((team, index) => (
            <img
              key={`${team.name}-${index}`}
              src={team.image}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className={`lol-detail-bg-img is-${index}`}
              onError={(click) => {
                click.currentTarget.style.display = 'none';
              }}
            />
          ))}
      </div>
      <header className="lol-detail-head">
        <div>
          <span>MATCH CENTER</span>
          <em>{event.blockName || '赛程'}</em>
        </div>
        <span className={`lol-state ${live ? 'is-live' : ''}`}>{stateLabel(event)}</span>
      </header>

      <div className="lol-detail-league">
        <span>{leagueName(event.league.name, event.league.slug)}</span>
        <em>{event.tournament.name}</em>
      </div>

      <div className="lol-scoreboard">
        <div className="lol-score-team">
          {a ? <TeamLogo team={a} size="lg" /> : <span className="lol-logo lol-logo--lg" />}
          <strong>{a ? teamName(a) : 'TBD'}</strong>
          <small>{a?.code || 'TBD'}</small>
        </div>
        <div className="lol-series">
          <strong>
            {event.state === 'unstarted' ? 'VS' : `${a?.score ?? 0} : ${b?.score ?? 0}`}
          </strong>
          <span>BO{event.bestOf || 1}</span>
          {live ? (
            <em className="lol-live-pill">LIVE NOW</em>
          ) : event.state === 'completed' ? (
            <em>已完赛</em>
          ) : (
            <em>{countdown(event.startTime, now)}</em>
          )}
        </div>
        <div className="lol-score-team">
          {b ? <TeamLogo team={b} size="lg" /> : <span className="lol-logo lol-logo--lg" />}
          <strong>{b ? teamName(b) : 'TBD'}</strong>
          <small>{b?.code || 'TBD'}</small>
        </div>
      </div>

      <div className="lol-detail-meta">
        <span>
          <CalendarDays size={12} /> {DATE_FMT.format(new Date(event.startTime))}
        </span>
        <span>
          <Swords size={12} /> {event.tournament.name}
        </span>
        <span>
          <Zap size={12} /> {event.league.region || 'INTERNATIONAL'}
        </span>
      </div>

      <div className="lol-detail-actions">
        <button type="button" className="lol-btn is-primary" onClick={() => onOpen(leagueUrl(event))}>
          <ExternalLink size={13} /> 官方页面
        </button>
        <button type="button" className="lol-btn" onClick={() => onSearch(event)}>
          <Search size={13} /> 搜高光
        </button>
      </div>

      <div className="lol-games">
        <header>
          <span>GAMES / VOD</span>
          <em>{event.games.length || event.bestOf || 1} 局</em>
        </header>
        {event.games.length === 0 && <p className="lol-muted">官方尚未放出本场局数。</p>}
        {event.games.map((game) => (
          <div className="lol-game" key={`${event.id}-${game.number}`}>
            <span>G{game.number}</span>
            <em className={game.state === 'completed' ? 'is-done' : ''}>{game.state}</em>
            {game.vods.length > 0 || game.recaps.length > 0 ? (
              <button
                type="button"
                className="lol-mini-btn"
                onClick={() => onOpen(vodLink(event, game))}
              >
                <Play size={11} /> 回放
              </button>
            ) : (
              <span className="lol-game-empty">—</span>
            )}
          </div>
        ))}
      </div>

      <footer className="lol-detail-foot">
        实时数据 · lolesports.com
        <span>{event.hasVod ? 'VOD 已同步' : '等待官方 VOD'}</span>
      </footer>
    </div>
  );
}

export function EsportsPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<LolOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('schedule');
  const [season, setSeason] = useState('');
  const [leagueId, setLeagueId] = useState('');
  const [tournamentId, setTournamentId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const now = useNow();

  const load = useCallback(async (force = false) => {
    setError('');
    setRefreshing(true);
    try {
      const next = await getLolEsportsOverview(force);
      setData(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(false);
    }, 90_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const events = data?.events ?? [];
  const seasons = data?.seasons ?? [];
  const leagues = data?.leagues ?? [];

  const years = useMemo(() => {
    const set = new Set<string>();
    for (const event of events) if (event.year) set.add(event.year);
    for (const item of seasons) {
      const year = Number(item.name);
      if (Number.isFinite(year) && year >= 2021) set.add(String(year));
    }
    return [...set].sort().reverse().slice(0, 8);
  }, [events, seasons]);

  const activeSeason = season || years[0] || String(new Date().getFullYear());
  const seasonEvents = useMemo(
    () => events.filter((event) => event.year === activeSeason),
    [events, activeSeason],
  );

  const leagueStats = useMemo(() => {
    const map = new Map<string, { league: LolOverview['leagues'][number]; count: number; live: number }>();
    for (const event of seasonEvents) {
      const current = map.get(event.league.id) || {
        league: leagues.find((l) => l.id === event.league.id) || event.league,
        count: 0,
        live: 0,
      };
      current.count += 1;
      if (event.state === 'inProgress') current.live += 1;
      map.set(event.league.id, current);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [seasonEvents, leagues]);

  /** 当前赛季出镜最多/世界排名最高的战队，用于明星战队条与背景图。 */
  const stars = useMemo<SeasonStar[]>(() => {
    const rankMap = new Map(
      (data?.worldRank ?? []).map((row) => [row.team.name.toLowerCase(), row.rank]),
    );
    const map = new Map<string, SeasonStar>();
    for (const event of seasonEvents) {
      for (const team of event.teams) {
        if (!team.name || team.name === 'TBD' || !team.image) continue;
        const key = team.name.toLowerCase();
        const rank = rankMap.get(key) ?? 999;
        const current = map.get(key) || {
          key,
          team,
          league: event.league.name,
          matches: 0,
          wins: 0,
          rank,
        };
        current.matches += 1;
        current.wins += team.outcome === 'win' ? 1 : 0;
        current.rank = Math.min(current.rank, rank);
        if (!current.league) current.league = event.league.name;
        map.set(key, current);
      }
    }
    return [...map.values()]
      .sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.matches - a.matches;
      })
      .slice(0, 6);
  }, [seasonEvents, data?.worldRank]);

  const focusTeam = (star: SeasonStar) => {
    const events = [...seasonEvents]
      .filter((event) => event.teams.some((team) => team.name.toLowerCase() === star.key))
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    const event = events[0];
    if (!event) return;
    setLeagueId(event.league.id);
    setTournamentId(event.tournament.id);
    setSelectedId(event.id);
    setTab('schedule');
  };

  const preferredLeague =
    leagueStats.find((item) => item.league.slug === 'worlds')?.league.id ||
    leagueStats.find((item) => item.league.slug === 'lpl')?.league.id ||
    leagueStats.find((item) => item.league.slug === 'lck')?.league.id ||
    leagueStats[0]?.league.id ||
    '';

  const activeLeagueId = leagueId || preferredLeague;
  const activeLeague =
    leagues.find((league) => league.id === activeLeagueId) ||
    leagueStats.find((item) => item.league.id === activeLeagueId)?.league;

  const leagueEvents = useMemo(
    () => seasonEvents.filter((event) => event.league.id === activeLeagueId),
    [seasonEvents, activeLeagueId],
  );

  const tournaments = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; events: LolEvent[]; start: number; end: number; live: number }
    >();
    for (const event of leagueEvents) {
      const key = event.tournament.id || event.tournament.name;
      const start = new Date(event.startTime).getTime();
      const current = map.get(key) || {
        id: key,
        name: event.tournament.name || '赛事',
        events: [],
        start,
        end: start,
        live: 0,
      };
      current.events.push(event);
      current.start = Math.min(current.start, start);
      current.end = Math.max(current.end, start);
      if (event.state === 'inProgress') current.live += 1;
      map.set(key, current);
    }
    return [...map.values()].sort((a, b) => {
      if (a.live !== b.live) return b.live - a.live;
      return b.end - a.end;
    });
  }, [leagueEvents]);

  const activeTournamentId = tournamentId || tournaments[0]?.id || '';
  const activeTournament = tournaments.find((item) => item.id === activeTournamentId);
  const activeSeasonMeta = seasons.find((item) => item.name === activeSeason);
  const visibleEvents = useMemo(
    () =>
      activeTournamentId
        ? leagueEvents.filter((event) => (event.tournament.id || event.tournament.name) === activeTournamentId)
        : leagueEvents,
    [leagueEvents, activeTournamentId],
  );

  const schedule = useMemo(() => {
    const sorted = [...visibleEvents].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );
    const groups = new Map<string, LolEvent[]>();
    for (const event of sorted) {
      const key = dayLabel(event.startTime);
      const list = groups.get(key) || [];
      list.push(event);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [visibleEvents]);

  const latestCompleted = useMemo(
    () =>
      [...visibleEvents]
        .filter((event) => event.state === 'completed')
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0],
    [visibleEvents],
  );

  const selected =
    visibleEvents.find((event) => event.id === selectedId) ||
    visibleEvents.find((event) => event.state === 'inProgress') ||
    visibleEvents.find(
      (event) =>
        event.state === 'unstarted' &&
        event.teams.length >= 2 &&
        event.teams.every((team) => team.name && team.name !== 'TBD'),
    ) ||
    latestCompleted ||
    visibleEvents.find((event) => event.state === 'unstarted') ||
    visibleEvents[visibleEvents.length - 1];

  const standings = useMemo(() => buildStandings(visibleEvents), [visibleEvents]);
  const highlights = useMemo(
    () =>
      [...leagueEvents]
        .filter((event) => event.state === 'completed')
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
        .slice(0, 8),
    [leagueEvents],
  );
  const previews = useMemo(
    () =>
      [...leagueEvents]
        .filter((event) => event.state === 'unstarted')
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        .slice(0, 8),
    [leagueEvents],
  );

  const liveCount = seasonEvents.filter((event) => event.state === 'inProgress').length;
  const seasonTournamentCount = new Set(seasonEvents.map((event) => event.tournament.id)).size;
  const teamsCount = new Set(
    visibleEvents
      .flatMap((event) => event.teams)
      .filter((team) => team.name && team.name !== 'TBD')
      .map((team) => team.name.toLowerCase()),
  ).size;

  const selectSeason = (value: string) => {
    setSeason(value);
    setLeagueId('');
    setTournamentId('');
    setSelectedId('');
  };
  const selectLeague = (value: string) => {
    setLeagueId(value);
    setTournamentId('');
    setSelectedId('');
  };
  const selectTournament = (value: string) => {
    setTournamentId(value);
    setSelectedId('');
  };

  const lastSync = data
    ? new Date(data.fetchedAt).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '--:--';

  if (loading && !data) {
    return (
      <div className="lol-shell">
        <div className="lol-skeleton">
          <div className="lol-skeleton-mark">LOL / ESPORTS OBSERVER</div>
          <div className="lol-skeleton-line is-wide" />
          <div className="lol-skeleton-line" />
          <div className="lol-skeleton-grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <span key={index} />
            ))}
          </div>
          <p>正在从 lolesports.com 拉取最新赛季与赛程…</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="lol-shell">
        <div className="lol-error">
          <Flame size={30} strokeWidth={1.1} />
          <span>DATA LINK / LOST</span>
          <h2>赛事数据没有接上</h2>
          <p>{error}</p>
          <div>
            <button type="button" className="lol-btn is-primary" onClick={() => void load(true)}>
              <RefreshCw size={14} /> 重新同步
            </button>
            <button type="button" className="lol-btn" onClick={onClose}>
              返回核心
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="lol-shell" aria-label="英雄联盟赛事观察版">
      <header className="lol-topbar">
        <div className="lol-brand">
          <span className="lol-brand-mark">LOL</span>
          <div>
            <strong>英雄联盟赛事观察版</strong>
            <small>ESPORTS OBSERVER · LIVE DATA</small>
          </div>
        </div>
        <div className="lol-topmeta">
          <span className={`lol-live-dot ${liveCount ? 'is-live' : ''}`} />
          <span>{liveCount ? `${liveCount} 场直播` : '当前无直播'}</span>
          <i />
          <span>{activeSeason} 赛季</span>
          <i />
          <span>{leagueStats.length} 个联赛</span>
          <i />
          <span className="lol-sync">同步 {lastSync}</span>
          <button
            type="button"
            className={`lol-iconbtn ${refreshing ? 'is-spinning' : ''}`}
            onClick={() => void load(true)}
            title="重新同步"
          >
            <RefreshCw size={15} />
          </button>
          <button type="button" className="lol-iconbtn" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
      </header>

      {error && data && (
        <div className="lol-banner">
          <Flame size={13} /> 本次同步失败，正在显示上一次数据：{error}
        </div>
      )}

      <div className="lol-grid">
        <aside className="lol-rail">
          <div className="lol-rail-block">
            <div className="lol-rail-head">
              <span>SEASON</span>
              <em>{years.length}</em>
            </div>
            <div className="lol-seasons">
              {years.map((year) => {
                const count = events.filter((event) => event.year === year).length;
                return (
                  <button
                    type="button"
                    key={year}
                    className={`lol-season ${year === activeSeason ? 'is-active' : ''}`}
                    onClick={() => selectSeason(year)}
                  >
                    <strong>{year}</strong>
                    <small>{count ? `${count} 场` : '档案'}</small>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lol-rail-block lol-rail-leagues">
            <div className="lol-rail-head">
              <span>LEAGUES</span>
              <em>{leagueStats.length}</em>
            </div>
            <div className="lol-league-list">
              {leagueStats.map(({ league, count, live }) => (
                <button
                  type="button"
                  key={league.id}
                  className={`lol-league ${league.id === activeLeagueId ? 'is-active' : ''}`}
                  onClick={() => selectLeague(league.id)}
                >
                  <span className="lol-league-logo">
                    {league.image ? (
                      <img
                        src={league.image}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <Trophy size={12} />
                    )}
                  </span>
                  <span>
                    <strong>{leagueName(league.name, league.slug)}</strong>
                    <small>{league.region || 'GLOBAL'}</small>
                  </span>
                  {live > 0 ? <i className="lol-live-pill">LIVE</i> : <em>{count}</em>}
                </button>
              ))}
              {leagueStats.length === 0 && <p className="lol-muted">该赛季暂无联赛数据。</p>}
            </div>
          </div>

          <div className="lol-rail-block">
            <div className="lol-rail-head">
              <span>WORLD RANK</span>
              <em>GPR</em>
            </div>
            <div className="lol-rank-list">
              {(data?.worldRank ?? []).slice(0, 6).map((row) => (
                <div className="lol-rank" key={row.teamId}>
                  <span className={row.rank <= 3 ? 'is-top' : ''}>{row.rank}</span>
                  <TeamLogo team={row.team} size="sm" />
                  <div>
                    <strong>{teamName(row.team)}</strong>
                    <small>{row.team.league || '—'}</small>
                  </div>
                  <em>{row.gprScore || row.elo}</em>
                </div>
              ))}
              {(data?.worldRank ?? []).length === 0 && <p className="lol-muted">暂无 GPR 排名。</p>}
            </div>
          </div>
        </aside>

        <main className="lol-main">
          <section className="lol-hero">
            <span className="lol-hero-watermark">{activeLeague?.slug || 'LOL'}</span>
            <div className="lol-hero-stars" aria-hidden="true">
              {stars.slice(0, 3).map((star, index) => (
                <img
                  key={star.key}
                  src={star.team.image}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className={`lol-hero-star is-${index}`}
                  onError={(click) => {
                    click.currentTarget.style.display = 'none';
                  }}
                />
              ))}
            </div>
            <div className="lol-hero-top">
              <div className="lol-hero-copy">
                <span className="lol-kicker">
                  {activeLeague?.region || 'INTERNATIONAL'} / {activeSeason} SEASON
                </span>
                <h1>{activeLeague ? leagueName(activeLeague.name, activeLeague.slug) : '英雄联盟赛事'}</h1>
                <p>
                  {activeTournament?.name || (activeLeague ? '当前赛季' : '赛季档案')} ·{' '}
                  {dateRange(
                    activeTournament ? new Date(activeTournament.start).toISOString() : undefined,
                    activeTournament ? new Date(activeTournament.end).toISOString() : undefined,
                  ) ||
                    (activeSeasonMeta
                      ? `${activeSeasonMeta.splits.length} 个赛段`
                      : '赛程实时同步中')}
                </p>
              </div>
              <div className="lol-hero-badge">
                <Trophy size={24} strokeWidth={1.1} />
                <span>{activeSeason}</span>
                <em>SEASON</em>
              </div>
            </div>
            <div className="lol-hero-stats">
              <div>
                <span>MATCHES</span>
                <strong>{visibleEvents.length}</strong>
              </div>
              <div>
                <span>TEAMS</span>
                <strong>{teamsCount || '—'}</strong>
              </div>
              <div>
                <span>TOURNAMENTS</span>
                <strong>{seasonTournamentCount || '—'}</strong>
              </div>
              <div>
                <span>LIVE</span>
                <strong className={liveCount ? 'is-live' : ''}>{liveCount || 0}</strong>
              </div>
            </div>
          </section>

          {stars.length > 0 && (
            <section className="lol-stars">
              <header>
                <span>STAR WATCH</span>
                <em>{activeSeason} · 明星战队</em>
              </header>
              <div className="lol-star-grid">
                {stars.map((star) => (
                  <button
                    type="button"
                    key={star.key}
                    className="lol-star"
                    onClick={() => focusTeam(star)}
                    title={`${teamName(star.team)} · ${star.league}`}
                  >
                    <span className="lol-star-art">
                      <img
                        src={star.team.image}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                    </span>
                    <span className="lol-star-copy">
                      <strong>{star.team.code || teamName(star.team)}</strong>
                      <small>
                        {star.team.region?.toUpperCase() || star.league} · {star.matches} 场
                      </small>
                    </span>
                    {star.rank < 999 ? <em className="lol-star-rank">#{star.rank}</em> : null}
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="lol-tournament-bar">
            {tournaments.map((tournament) => (
              <button
                type="button"
                key={tournament.id}
                className={`lol-tournament ${tournament.id === activeTournamentId ? 'is-active' : ''}`}
                onClick={() => selectTournament(tournament.id)}
              >
                <span>{tournament.name}</span>
                <small>
                  {tournament.events.length} 场{tournament.live ? ' · LIVE' : ''}
                </small>
              </button>
            ))}
            {tournaments.length === 0 && (
              <span className="lol-muted">该联赛在这个赛季还没有可展示的赛程。</span>
            )}
          </div>

          <nav className="lol-tabs" aria-label="赛事视图">
            {(Object.keys(TAB_LABEL) as Tab[]).map((key) => (
              <button
                type="button"
                key={key}
                className={tab === key ? 'is-active' : ''}
                onClick={() => setTab(key)}
              >
                {key === 'schedule' && <CalendarDays size={13} />}
                {key === 'standings' && <BarChart3 size={13} />}
                {key === 'highlights' && <Play size={13} />}
                {key === 'preview' && <Clock3 size={13} />}
                {TAB_LABEL[key]}
                <small>
                  {key === 'schedule'
                    ? visibleEvents.length
                    : key === 'standings'
                      ? standings.length
                      : key === 'highlights'
                        ? highlights.length
                        : previews.length}
                </small>
              </button>
            ))}
          </nav>

          <div className="lol-scroll">
            {tab === 'schedule' && (
              <div className="lol-schedule">
                {schedule.map(([day, list]) => (
                  <section className="lol-day" key={day}>
                    <header>
                      <span>{day}</span>
                      <em>{list.length} MATCHES</em>
                    </header>
                    {list.map((event) => (
                      <MatchRow
                        key={event.id}
                        event={event}
                        selected={event.id === selected?.id}
                        onSelect={() => setSelectedId(event.id)}
                      />
                    ))}
                  </section>
                ))}
                {schedule.length === 0 && (
                  <div className="lol-empty">
                    <Trophy size={26} strokeWidth={1.1} />
                    <strong>这个赛季还没有赛程</strong>
                    <p>切换左侧赛季/联赛，或点右上角重新同步。</p>
                    {activeSeasonMeta && activeSeasonMeta.splits.length > 0 && (
                      <div className="lol-archive">
                        <header>
                          <span>SEASON ARCHIVE</span>
                          <em>{activeSeason}</em>
                        </header>
                        {activeSeasonMeta.splits.slice(0, 8).map((split) => (
                          <div className="lol-archive-row" key={split.id || split.slug}>
                            <strong>{split.name.replaceAll('_', ' ')}</strong>
                            <span>{dateRange(split.startTime, split.endTime)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {tab === 'standings' && (
              <div className="lol-standings">
                <header>
                  <div>
                    <span>STANDINGS / SERIES</span>
                    <h3>{activeTournament?.name || '当前赛事'} 积分榜</h3>
                  </div>
                  <em>按大场胜率 · 小分差排序</em>
                </header>
                <div className="lol-standing-head">
                  <span>#</span>
                  <span>战队</span>
                  <span>大场</span>
                  <span>小分</span>
                  <span>胜率</span>
                </div>
                {standings.map((row, index) => {
                  const rate = row.wins / Math.max(1, row.played);
                  return (
                    <div className={`lol-standing ${index < 4 ? 'is-top' : ''}`} key={row.team.id || row.team.name}>
                      <span className="lol-standing-rank">{index + 1}</span>
                      <span className="lol-standing-team">
                        <TeamLogo team={row.team} size="sm" />
                        <strong>{teamName(row.team)}</strong>
                        <small>{row.team.code}</small>
                      </span>
                      <span>
                        {row.wins}W {row.losses}L
                      </span>
                      <span>
                        {row.gameWins}-{row.gameLosses}
                      </span>
                      <span>{Math.round(rate * 100)}%</span>
                    </div>
                  );
                })}
                {standings.length === 0 && (
                  <div className="lol-empty">
                    <BarChart3 size={26} strokeWidth={1.1} />
                    <strong>还没有可计算的积分</strong>
                    <p>等这个赛事有已结束的比赛后，榜单会自动生成。</p>
                  </div>
                )}
              </div>
            )}

            {tab === 'highlights' && (
              <div className="lol-highlight-grid">
                {highlights.map((event) => {
                  const [a, b] = event.teams;
                  return (
                    <article className="lol-highlight" key={event.id}>
                      <div className="lol-highlight-top">
                        <span>{dayLabel(event.startTime)}</span>
                        <em>{event.blockName || event.tournament.name}</em>
                      </div>
                      <div className="lol-highlight-teams">
                        {a ? <TeamLogo team={a} size="md" /> : <span className="lol-logo" />}
                        <strong>
                          {a?.score ?? 0} <i>:</i> {b?.score ?? 0}
                        </strong>
                        {b ? <TeamLogo team={b} size="md" /> : <span className="lol-logo" />}
                      </div>
                      <h3>
                        {a ? teamName(a) : 'TBD'} <i>vs</i> {b ? teamName(b) : 'TBD'}
                      </h3>
                      <p>
                        {event.tournament.name} · BO{event.bestOf || 1} ·{' '}
                        {event.hasVod ? '官方 VOD 已上线' : 'VOD 待补'}
                      </p>
                      <div className="lol-highlight-actions">
                        <button type="button" className="lol-btn is-primary" onClick={() => openLink(vodLink(event))}>
                          <Play size={12} /> 看集锦
                        </button>
                        <button type="button" className="lol-btn" onClick={() => searchHighlights(event)}>
                          <Search size={12} /> 搜索
                        </button>
                      </div>
                    </article>
                  );
                })}
                {highlights.length === 0 && (
                  <div className="lol-empty">
                    <Play size={26} strokeWidth={1.1} />
                    <strong>还没有可用的高光</strong>
                    <p>比赛结束后，官方 VOD 与集锦入口会自动出现。</p>
                  </div>
                )}
              </div>
            )}

            {tab === 'preview' && (
              <div className="lol-preview-grid">
                {previews.map((event) => {
                  const [a, b] = event.teams;
                  return (
                    <article className="lol-preview" key={event.id} onClick={() => setSelectedId(event.id)}>
                      <div className="lol-preview-top">
                        <span className="lol-preview-live">
                          <Clock3 size={12} /> {countdown(event.startTime, now)}
                        </span>
                        <em>{event.blockName || event.tournament.name}</em>
                      </div>
                      <div className="lol-preview-match">
                        <div>
                          {a ? <TeamLogo team={a} size="md" /> : <span className="lol-logo" />}
                          <strong>{a ? teamName(a) : 'TBD'}</strong>
                        </div>
                        <span className="lol-preview-vs">VS</span>
                        <div>
                          {b ? <TeamLogo team={b} size="md" /> : <span className="lol-logo" />}
                          <strong>{b ? teamName(b) : 'TBD'}</strong>
                        </div>
                      </div>
                      <p>
                        {event.tournament.name} · BO{event.bestOf || 1} ·{' '}
                        {DATE_FMT.format(new Date(event.startTime))}
                      </p>
                      <button
                        type="button"
                        className="lol-btn"
                        onClick={(click) => {
                          click.stopPropagation();
                          setSelectedId(event.id);
                        }}
                      >
                        <Swords size={12} /> 赛前情报
                      </button>
                    </article>
                  );
                })}
                {previews.length === 0 && (
                  <div className="lol-empty">
                    <Clock3 size={26} strokeWidth={1.1} />
                    <strong>暂时没有待开赛的比赛</strong>
                    <p>当前赛程已全部结束，等官方放出下一轮。</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        <aside className="lol-side">
          <MatchDetail
            event={selected}
            now={now}
            onOpen={openLink}
            onSearch={searchHighlights}
          />
          <div className="lol-side-note">
            <Crown size={13} />
            <span>数据每 90 秒自动同步</span>
            <em>lolesports.com</em>
          </div>
        </aside>
      </div>
    </section>
  );
}
