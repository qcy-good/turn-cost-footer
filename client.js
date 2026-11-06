/**
 * Client half of turn-cost-footer.
 *
 * The conversation has no per-message footer slot, so the chip is injected into the
 * completed-Turn footer line that already renders `用量 … · 时间`. Every selector lives
 * in SELECTORS; nothing else in this file knows the DOM shape.
 *
 * Data comes from the Host half (`/turn-cost-footer/turn.json`) — never estimated here.
 */
window.__ModuleLoader__.load({
  id: 'turn-cost-footer',
  factory() {
    const ENDPOINT = '/turn-cost-footer/turn.json';
    const POLL_MS = 1000;
    // Retry ladder after a Turn completes: React may replace the footer subtree.
    const RETRY_MS = [300, 1200, 3000];
    const SELECTORS = {
      endRow: '[data-clock="end"]',
      endInfo: '[class*="endInfo"]',
    };
    const CHIP_CLASS = 'turn-cost-footer-cost';

    let enabled = true;
    let current = null;
    let seenSeq = -1;
    let seenSignature = '';
    let unreachable = 0;
    let pollTimer = 0;
    let reconcileTimer = 0;
    let observer = null;
    let stopped = false;

    function isZh() {
      const lang = (document.documentElement && document.documentElement.lang) || navigator.language || '';
      return /^zh/i.test(lang);
    }

    function money(amount, currency) {
      const value = Number(amount);
      if (!Number.isFinite(value)) return '';
      const unit = !currency || currency === 'CNY' ? '¥' : currency + ' ';
      // 角以下的小额保留更多位，避免显示成 ¥0.00。
      const digits = value >= 0.1 ? 2 : value >= 0.001 ? 3 : 4;
      return unit + value.toFixed(digits);
    }

    function chipText(record) {
      let text = '· ' + (isZh() ? '本轮' : 'this turn') + ' ' + money(record.amount, record.currency);
      // 今日累计接在同一行，尾随时钟之后。
      if (Number.isFinite(record.todayUsage)) {
        text += ' · ' + (isZh() ? '今日' : 'today') + ' ' + money(record.todayUsage, record.currency);
      }
      return text;
    }

    function chipTitle(record) {
      const parts = [];
      if (record.model) parts.push(String(record.model));
      if (Number.isFinite(record.tokens)) parts.push(record.tokens.toLocaleString() + ' tok');
      return parts.join(' · ');
    }

    function lastEndInfo() {
      const rows = document.querySelectorAll(SELECTORS.endRow);
      if (!rows.length) return null;
      const row = rows[rows.length - 1];
      return row.querySelector(SELECTORS.endInfo) || row;
    }

    function removeChips() {
      for (const el of document.querySelectorAll('.' + CHIP_CLASS)) el.remove();
    }

    function isChip(el) {
      return Boolean(el && el.classList && el.classList.contains(CHIP_CLASS));
    }

    /** 时钟节点：页脚里形如 22:17 的那个元素（可能带 time/clock 类名）。 */
    function timeNode(info) {
      const kids = info.children;
      for (let i = kids.length - 1; i >= 0; i -= 1) {
        const el = kids[i];
        if (isChip(el)) continue;
        if (el.tagName === 'TIME' || /time|clock/i.test(String(el.className || ''))) return el;
      }
      return null;
    }

    function lastNonChip(info) {
      const kids = info.children;
      for (let i = kids.length - 1; i >= 0; i -= 1) {
        if (!isChip(kids[i])) return kids[i];
      }
      return null;
    }

    function satisfied() {
      if (!current) return false;
      const info = lastEndInfo();
      if (!info) return false;
      const chip = info.querySelector('.' + CHIP_CLASS);
      return Boolean(
        chip &&
          chip.isConnected &&
          info.lastElementChild === chip &&
          chip.getAttribute('data-turn') === String(current.turn) &&
          chip.textContent === chipText(current),
      );
    }

    function ensureChip() {
      if (stopped) return;
      if (!enabled || !current) {
        removeChips();
        return;
      }
      const info = lastEndInfo();
      if (!info) return;
      const anchor = timeNode(info) || lastNonChip(info);
      const text = chipText(current);
      let chip = info.querySelector('.' + CHIP_CLASS);
      if (!chip) {
        chip = document.createElement('span');
        chip.className = CHIP_CLASS;
        chip.style.whiteSpace = 'nowrap';
      }
      chip.setAttribute('data-turn', String(current.turn));
      if (chip.textContent !== text) chip.textContent = text;
      const title = chipTitle(current);
      if (chip.title !== title) chip.title = title;
      // 字号跟随时钟，避免比“22:17”明显大一号。
      if (anchor) {
        const size = getComputedStyle(anchor).fontSize;
        if (size && chip.style.fontSize !== size) chip.style.fontSize = size;
      }
      // 始终收在行尾：用量 580K tok 22:17 · 本轮 ¥x · 今日 ¥y
      if (anchor) {
        if (anchor.nextElementSibling !== chip) anchor.after(chip);
      } else if (!chip.isConnected) {
        info.appendChild(chip);
      }
    }

    function reconcileSoon() {
      if (stopped || reconcileTimer) return;
      reconcileTimer = setTimeout(() => {
        reconcileTimer = 0;
        if (!satisfied()) ensureChip();
      }, 120);
    }

    /** The Host half is gone (row disabled, uninstalled, restarting): stop showing a stale chip. */
    function unavailable() {
      unreachable += 1;
      if (unreachable >= 2) removeChips();
    }

    async function poll() {
      if (stopped) return;
      try {
        const response = await fetch(ENDPOINT, { cache: 'no-store' });
        if (!response.ok) {
          unavailable();
          return;
        }
        const data = await response.json();
        if (!data || data.ok !== true) {
          unavailable();
          return;
        }
        unreachable = 0;
        const nextEnabled = data.enabled !== false;
        if (nextEnabled !== enabled) {
          enabled = nextEnabled;
          if (!enabled) removeChips();
        }
        const seqChanged = typeof data.seq === 'number' && data.seq !== seenSeq;
        // 今日累计会被子代理轮次推高而 seq 不变，所以签名里带上金额。
        const signature = [data.seq, data.amount, data.todayUsage].join('|');
        if (seqChanged || signature !== seenSignature) {
          seenSignature = signature;
          if (typeof data.seq === 'number') seenSeq = data.seq;
          current = Number.isFinite(data.amount)
            ? {
                turn: data.turn,
                amount: data.amount,
                currency: data.currency,
                tokens: data.tokens,
                todayUsage: data.todayUsage,
              }
            : null;
          if (!current) {
            removeChips();
            return;
          }
          ensureChip();
          if (seqChanged) for (const delay of RETRY_MS) setTimeout(ensureChip, delay);
        } else if (enabled && current) {
          reconcileSoon();
        }
      } catch {
        unavailable();
      }
    }

    function stop() {
      stopped = true;
      if (pollTimer) clearInterval(pollTimer);
      if (reconcileTimer) clearTimeout(reconcileTimer);
      if (observer) observer.disconnect();
      removeChips();
    }

    return {
      inject: [],
      apply(ctx) {
        if (typeof ctx === 'object' && ctx && typeof ctx.effect === 'function') {
          ctx.effect(() => () => stop());
        }
        pollTimer = setInterval(poll, POLL_MS);
        observer = new MutationObserver(() => {
          if (current && enabled) reconcileSoon();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') poll();
        });
        poll();
      },
    };
  },
});
