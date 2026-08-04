import { createSignal } from 'solid-js';
import { jsx } from '@opentui/solid/jsx-runtime';
import { RGBA } from '@opentui/core';
import type { TuiPluginModule } from '@opencode-ai/plugin/tui';
import { formatTuiFooterSegments, getTuiGitInfo, gitInfoForRoute, tuiRouteSnapshot, type TuiGitInfo, type TuiRouteSnapshot } from '../../src/tui/footer.js';
import { updateWeeklyState } from '../../src/data/openrouter-weekly.js';
import { fetchOpenRouterBalanceWithSource } from '../../src/tui/openrouter.js';
import { loadSettings } from '../../src/utils/config.js';

const BALANCE_REFRESH_INTERVAL = 60_000;
const GIT_REFRESH_INTERVAL = 10_000;
const ROUTE_POLL_INTERVAL = 100;
const EMPTY_GIT: TuiGitInfo = { isRepo: false, root: null, branch: null };

export function tuiTextColor(color: 'gray' | number): string | RGBA {
  return typeof color === 'number' ? RGBA.fromIndex(color) : color;
}

const module: TuiPluginModule = {
  id: 'ocstatusline',
  tui: async (api) => {
    const [revision, refresh] = createSignal(0);
    const [currentSnapshot, setCurrentSnapshot] = createSignal<TuiRouteSnapshot>(tuiRouteSnapshot(api.route.current, api.state));
    const weeklyBudgetUsd = loadSettings().openrouter.weeklyBudgetUsd;
    let openrouterWeekly = updateWeeklyState(null, weeklyBudgetUsd, Date.now());
    let lastGit = EMPTY_GIT;
    let gitSessionKey: string | null = null;
    let gitLoadingKey: string | null = null;
    let gitController: AbortController | null = null;
    let disposed = false;
    const balanceController = new AbortController();
    const bump = () => refresh((value) => value + 1);
    const publishRoute = (snapshot: TuiRouteSnapshot): boolean => {
      const previous = currentSnapshot();
      if (snapshot.key === previous.key && snapshot.cwd === previous.cwd) return false;
      setCurrentSnapshot(snapshot);
      gitController?.abort();
      gitController = null;
      gitSessionKey = null;
      gitLoadingKey = null;
      lastGit = EMPTY_GIT;
      bump();
      return true;
    };
    const refreshBalance = async () => {
      const nextBalance = await fetchOpenRouterBalanceWithSource(3000, balanceController.signal);
      if (disposed) return;
      openrouterWeekly = updateWeeklyState(nextBalance, weeklyBudgetUsd, Date.now(), openrouterWeekly);
      bump();
    };
    const refreshGit = async (snapshot: TuiRouteSnapshot) => {
      if (disposed) return;
      const { cwd, key: nextKey } = snapshot;
      if (!nextKey) return;
      if (gitController && !gitController.signal.aborted && nextKey === gitLoadingKey) return;
      const loadedKey = nextKey;
      const controller = new AbortController();
      gitController = controller;
      gitLoadingKey = loadedKey;
      const nextGit = await getTuiGitInfo(cwd, controller.signal);
      if (disposed || controller.signal.aborted || loadedKey !== currentSnapshot().key) return;
      lastGit = nextGit;
      gitSessionKey = loadedKey;
      if (gitController === controller) {
        gitController = null;
        gitLoadingKey = null;
      }
      bump();
    };
    const checkRoute = () => {
      const snapshot = tuiRouteSnapshot(api.route.current, api.state);
      if (publishRoute(snapshot)) void refreshGit(snapshot);
    };
    const cleanups = [
      api.event.on('message.updated', bump),
      api.event.on('session.status', bump),
      api.event.on('session.idle', bump),
      api.event.on('session.error', bump),
    ];
    const timer = setInterval(refreshBalance, BALANCE_REFRESH_INTERVAL);
    const gitTimer = setInterval(() => void refreshGit(currentSnapshot()), GIT_REFRESH_INTERVAL);
    const routeTimer = setInterval(checkRoute, ROUTE_POLL_INTERVAL);
    void refreshBalance();
    void refreshGit(currentSnapshot());
    api.lifecycle.onDispose(() => {
      disposed = true;
      clearInterval(timer);
      clearInterval(gitTimer);
      clearInterval(routeTimer);
      balanceController.abort();
      gitController?.abort();
      for (const cleanup of cleanups) cleanup();
    });
    api.slots.register({
      order: 100,
      slots: {
        app_bottom: () => {
          revision();
            const snapshot = currentSnapshot();
            const git = gitInfoForRoute(snapshot.key, gitSessionKey, lastGit);
            const segments = formatTuiFooterSegments(openrouterWeekly, git, Date.now());
            const [weekly, repository, account] = segments;
            return jsx('box', { width: '100%', paddingLeft: 1, flexDirection: 'row', flexWrap: 'no-wrap', overflow: 'hidden', children: [
              weekly ? jsx('text', { fg: tuiTextColor(weekly.color), wrapMode: 'none', children: weekly.text }) : null,
              repository ? jsx('text', { fg: 'gray', wrapMode: 'none', children: ' · ' }) : null,
              repository ? jsx('text', { fg: repository.color, wrapMode: 'none', flexShrink: 1, overflow: 'hidden', children: repository.text }) : null,
              account ? jsx('text', { fg: 'gray', wrapMode: 'none', marginLeft: 'auto', children: ' · ' }) : null,
              account ? jsx('text', { fg: tuiTextColor(account.color), wrapMode: 'none', children: account.text }) : null,
            ] });
          },
      },
    });
    // Claim the built-in home-screen footer slot (internal:home-footer registers it at
    // order: 100) with a lower order so we win the single_winner race and suppress
    // OpenCode's own cwd/branch/version line — app_bottom above already covers that
    // info on the home screen, so this slot renders nothing.
    api.slots.register({
      order: 50,
      slots: {
        home_footer: () => null,
      },
    });
  },
};

export default module;
