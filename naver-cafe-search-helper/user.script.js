// ==UserScript==
// @name         Naver Cafe Search User Stats
// @version      0.7.0
// @description  네이버 카페 검색 결과 페이지에서 작성자별 글 통계를 화면에 표시합니다.
// @match        https://cafe.naver.com/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// @author       gd0live
// @namespace    https://greasyfork.org/users/1609753
// @homepageURL  https://greasyfork.org/scripts/581297
// @supportURL   https://greasyfork.org/scripts/581297/feedback
// @downloadURL  https://update.greasyfork.org/scripts/581297/Naver%20Cafe%20Search%20User%20Stats.user.js
// @updateURL    https://update.greasyfork.org/scripts/581297/Naver%20Cafe%20Search%20User%20Stats.meta.js
// ==/UserScript==

(function () {
    "use strict";

    const CONFIG = {
        panelId: "ncafe-stat-panel",
        buttonId: "ncafe-stat-floating-btn",
        styleId: "ncafe-stat-style",

        boardSelector: ".article-board",
        resultSelector: "table.article-table tbody tr a.article",
        rowSelector: "table.article-table tbody tr",

        observeDebounceMs: 300,
        loadingDelayMs: 150,
        initialWaitMs: 10000,
        collectDelayMs: 350,
        apiPerPage: 40,
        defaultClosed: true,
    };

    let isInternalUpdate = false;
    let loadingTimer = null;
    let isCollectingAll = false;

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

    const cleanText = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    const getParams = () => new URL(location.href).searchParams;
    const hasSearchQuery = () => Boolean(getSearchKeyword());
    const getSearchKeyword = () => (
        getParams().get("q")
        || getParams().get("query")
        || getParams().get("search.query")
        || ""
    );

    function isArticleContentPage() {
        return /\/articles\/\d+(?:[/?#]|$)/.test(location.pathname);
    }

    function isSearchResultsPage() {
        if (!hasSearchQuery()) return false;
        if (isArticleContentPage()) return false;

        if ($(CONFIG.boardSelector) || $(CONFIG.resultSelector)) return true;

        return (
            /\/menus\/\d+(?:[/?#]|$)/.test(location.pathname)
            || /(?:Article)?Search(?:List)?\.nhn$/i.test(location.pathname)
        );
    }

    function getCafeId() {
        const params = getParams();
        const cafeId =
            params.get("cafeId")
            || params.get("clubid")
            || params.get("search.clubid")
            || location.pathname.match(/\/cafes\/(\d+)/)?.[1]
            || window.g_sClubId
            || window.g_sCafeId
            || window.cafeId
            || window.clubid
            || document.querySelector("[name='clubid']")?.value
            || document.querySelector("[name='search.clubid']")?.value;

        return cafeId || "";
    }

    function getMenuId() {
        const params = getParams();
        return (
            params.get("menuId")
            || params.get("search.menuid")
            || location.pathname.match(/\/menus\/(\d+)/)?.[1]
            || "0"
        );
    }

    function getPageSize() {
        const size = Number(getParams().get("size"));
        return size > 0 ? size : CONFIG.apiPerPage;
    }

    function getParamAny(...names) {
        const params = getParams();

        for (const name of names) {
            const value = params.get(name);
            if (value) return value;
        }

        return "";
    }

    function normalizeDateText(value) {
        const text = String(value || "").trim();
        const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
        if (compact) {
            return `${compact[1]}-${compact[2]}-${compact[3]}`;
        }

        const match = text.match(/(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);

        if (!match) return text;

        return [
            match[1],
            match[2].padStart(2, "0"),
            match[3].padStart(2, "0"),
        ].join("-");
    }

    function getDateInputsFromDom() {
        const candidates = $$("input").map((input) => ({
            input,
            text: normalizeDateText(input.value || input.getAttribute("value") || ""),
            name: `${input.name || ""} ${input.id || ""} ${input.className || ""} ${input.placeholder || ""}`.toLowerCase(),
        })).filter((candidate) => /^\d{4}-\d{2}-\d{2}$/.test(candidate.text));

        if (!candidates.length) {
            return { startDate: "", endDate: "" };
        }

        const start =
            candidates.find((candidate) => /start|from|begin|시작/.test(candidate.name))
            || candidates[0];
        const end =
            candidates.find((candidate) => /end|to|until|종료|끝/.test(candidate.name))
            || candidates[candidates.length - 1];

        return {
            startDate: start?.text || "",
            endDate: end?.text || "",
        };
    }

    function getSelectedPeriodFromDom() {
        const periodPattern = /(전체\s*기간|전체|1\s*일|1\s*주|1\s*개월|3\s*개월|6\s*개월|1\s*년|직접\s*설정|수동)/;
        const selectedSelectors = [
            "[aria-selected='true']",
            "[aria-pressed='true']",
            "[data-selected='true']",
            ".selected",
            ".is-selected",
            ".active",
            ".is-active",
        ].join(",");

        const selectedText = $$(selectedSelectors)
            .map((el) => cleanText(el))
            .find((text) => periodPattern.test(text));

        if (selectedText) return selectedText.match(periodPattern)?.[1] || selectedText;

        const allPeriodText = $$("button, a, label, [role='button'], [role='tab']")
            .map((el) => ({
                text: cleanText(el),
                className: String(el.className || ""),
            }))
            .find((candidate) => (
                periodPattern.test(candidate.text)
                && /선택|selected|active/.test(candidate.className)
            ))?.text;

        return allPeriodText?.match(periodPattern)?.[1] || "";
    }

    function getSearchDateRange() {
        const domDates = getDateInputsFromDom();
        return {
            startDate: getParamAny(
                "from",
                "startDate",
                "start_date",
                "fromDate",
                "from_date",
                "dateFrom",
                "date_from",
                "search.startDate",
                "search.start_date",
                "search.fromDate",
                "search.dateFrom"
            ) || domDates.startDate,
            endDate: getParamAny(
                "to",
                "endDate",
                "end_date",
                "toDate",
                "to_date",
                "dateTo",
                "date_to",
                "search.endDate",
                "search.end_date",
                "search.toDate",
                "search.dateTo"
            ) || domDates.endDate,
            period: getParamAny(
                "p",
                "period",
                "range",
                "dateRange",
                "date_range",
                "date",
                "dateType",
                "date_type",
                "search.period",
                "search.range",
                "search.dateRange",
                "search.date_range",
                "search.date",
                "search.dateType",
                "search.date_type"
            ) || getSelectedPeriodFromDom(),
        };
    }

    function getPeriodLabel(period) {
        const normalized = String(period || "").trim().toLowerCase();
        const labels = {
            all: "전체기간",
            total: "전체기간",
            entire: "전체기간",
            day: "1일",
            "1d": "1일",
            "7d": "7일",
            daily: "1일",
            week: "1주",
            "1w": "1주",
            weekly: "1주",
            month: "1개월",
            "1m": "1개월",
            monthly: "1개월",
            "3m": "3개월",
            "6m": "6개월",
            year: "1년",
            "1y": "1년",
            custom: "직접설정",
            manual: "직접설정",
        };

        if (/전체\s*기간|^전체$/.test(period)) return "전체기간";
        if (/1\s*일/.test(period)) return "1일";
        if (/1\s*주/.test(period)) return "1주";
        if (/1\s*개월/.test(period)) return "1개월";
        if (/3\s*개월/.test(period)) return "3개월";
        if (/6\s*개월/.test(period)) return "6개월";
        if (/1\s*년/.test(period)) return "1년";
        if (/직접\s*설정|수동/.test(period)) return "직접설정";

        return labels[normalized] || period || "";
    }

    function getSearchPeriodText() {
        const range = getSearchDateRange();

        if (range.startDate || range.endDate) {
            return `${range.startDate || "-"} ~ ${range.endDate || "-"}`;
        }

        return getPeriodLabel(range.period) || "-";
    }

    function hasSpecificDateRange() {
        const range = getSearchDateRange();
        const period = String(range.period || "").toLowerCase();

        if (range.startDate && range.endDate) return true;

        return Boolean(period && !["all", "total", "entire"].includes(period));
    }

    function getStatsCsvDisabledReason() {
        if (isCollectingAll) return "모두 수집 중입니다.";
        if (!hasSpecificDateRange()) return "모두수집은 전체기간이 아닌 기간을 선택했을 때만 사용할 수 있습니다.";

        return "";
    }

    function getExportAllTitle() {
        if (isCollectingAll) return "모두 수집 중입니다.";
        if (hasSpecificDateRange()) return "모두 수집 후 통계 CSV 다운로드";

        return "모두수집은 전체기간이 아닌 기간을 선택했을 때만 사용할 수 있습니다.";
    }

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function debounce(fn, delay = 300) {
        let timer = null;

        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    }

    function getWriterInfo(row) {
        const button =
            $(".ArticleBoardWriterInfo .nick_btn", row)
            || $(".nick_btn", row);

        const nickname =
            $(".nickname", button)
            || $(".nickname", row);

        if (!button || !nickname) {
            return null;
        }

        return {
            id: button.id || cleanText(nickname),
            nickname: cleanText(nickname),
        };
    }

    function parseArticleRow(row) {
        const article = $("a.article", row);
        const writer = getWriterInfo(row);

        if (!article || !writer) return null;

        const cells = $$("td", row);

        return {
            title: cleanText(article),
            url: article.href,
            writerId: writer.id,
            writerName: writer.nickname,
            date: cleanText(cells[cells.length - 2]),
            view: cleanText(cells[cells.length - 1]),
        };
    }

    function parseArticles() {
        return $$(CONFIG.rowSelector).map(parseArticleRow).filter(Boolean);
    }

    function createWriterStats(items) {
        const map = new Map();

        for (const item of items) {
            const stat = map.get(item.writerId) || {
                writerId: item.writerId,
                writerName: item.writerName,
                count: 0,
                posts: [],
            };

            stat.count += 1;
            stat.posts.push(item);
            map.set(item.writerId, stat);
        }

        return [...map.values()].sort((a, b) => b.count - a.count);
    }

    function createApiArticleUrl(item) {
        if (!item?.cafeId || !item?.articleId) return "";
        return `https://cafe.naver.com/ca-fe/cafes/${item.cafeId}/articles/${item.articleId}`;
    }

    function parseApiArticle(entry) {
        const item = entry?.item;
        if (!item) return null;

        const writer = item.writerInfo || {};
        const writerId = writer.memberKey || writer.nickname || "";

        if (!writerId) return null;

        return {
            title: item.subject || "",
            url: createApiArticleUrl(item),
            writerId,
            writerName: writer.nickname || writerId,
            date: item.addDate || item.currentSecTime || "",
            view: String(item.readCount ?? ""),
            like: String(item.likeItCount ?? item.likeCount ?? ""),
            comment: String(item.commentCount ?? ""),
            cafeId: String(item.cafeId ?? ""),
            menuId: String(item.menuId ?? ""),
            articleId: String(item.articleId ?? ""),
        };
    }

    function createSearchApiUrl(page) {
        const cafeId = getCafeId();
        const query = getSearchKeyword();
        const params = getParams();

        if (!cafeId || !query) return "";

        const url = new URL(`https://apis.cafe.naver.com/search/v2/cafes/${cafeId}/search/articles`);
        url.searchParams.set("query", query);
        url.searchParams.set("perPage", String(getPageSize()));
        url.searchParams.set("page", String(page));
        url.searchParams.set("menuId", getMenuId());
        url.searchParams.set("views", "MEMBER_LEVEL,COUNT,SALE_INFO,CAFE_MENU");

        for (const name of ["ta", "p", "from", "to"]) {
            const value = params.get(name);
            if (value) {
                url.searchParams.set(name, value);
            }
        }

        return url.href;
    }

    function createSearchPageUrl(page) {
        const cafeId = getCafeId();
        const query = getSearchKeyword();
        const params = getParams();

        if (!cafeId || !query) return "";

        const url = new URL(`https://cafe.naver.com/f-e/cafes/${cafeId}/menus/${getMenuId()}`);
        url.searchParams.set("q", query);
        url.searchParams.set("page", String(page));
        url.searchParams.set("size", String(getPageSize()));

        for (const name of ["ta", "p", "from", "to"]) {
            const value = params.get(name);
            if (value) {
                url.searchParams.set(name, value);
            }
        }

        return url.href;
    }

    async function warmSearchPage(page) {
        const url = createSearchPageUrl(page);
        if (!url) return;

        const response = await fetch(url, {
            credentials: "include",
            referrerPolicy: "unsafe-url",
            headers: {
                accept: "*/*",
                rsc: "1",
                "next-url": `/cafes/${getCafeId()}/menus/${getMenuId()}`,
            },
        });

        if (!response.ok) {
            console.warn("[NCafeStats] warm search page failed", {
                status: response.status,
                url,
            });
        }
    }

    async function fetchSearchApiPage(page) {
        const url = createSearchApiUrl(page);
        if (!url) {
            throw new Error("카페 ID 또는 검색어를 찾을 수 없습니다.");
        }

        const response = await fetch(url, {
            credentials: "include",
            referrerPolicy: "unsafe-url",
            headers: {
                accept: "*/*",
                "x-cafe-product": "pc",
            },
        });

        if (!response.ok) {
            const body = await response.text().catch(() => "");
            console.warn("[NCafeStats] API request failed", {
                status: response.status,
                url,
                body,
            });
            throw new Error(`API 요청 실패: ${response.status}`);
        }

        return response.json();
    }

    async function collectAllArticles(onProgress) {
        const items = [];
        const seenKeys = new Set();
        let page = 1;
        let totalArticleCount = 0;

        while (true) {
            onProgress?.({ page, count: items.length, totalArticleCount });

            await warmSearchPage(page);
            const data = await fetchSearchApiPage(page);
            const result = data?.result || {};
            const pageItems = (result.articleList || []).map(parseApiArticle).filter(Boolean);
            const pageInfo = result.pageInfo || {};

            totalArticleCount = Number(pageInfo.totalArticleCount || totalArticleCount || 0);

            for (const item of pageItems) {
                const key = item.articleId
                    ? `${item.cafeId}:${item.articleId}`
                    : `${item.writerId}:${item.title}:${item.date}`;

                if (seenKeys.has(key)) continue;
                if (totalArticleCount && items.length >= totalArticleCount) break;

                seenKeys.add(key);
                items.push(item);
            }

            onProgress?.({ page, count: items.length, totalArticleCount });

            if (
                !pageItems.length
                || !pageInfo.visibleNextButton
                || (totalArticleCount && items.length >= totalArticleCount)
            ) break;

            page += 1;
            await delay(CONFIG.collectDelayMs);
        }

        return {
            items,
            totalArticleCount,
        };
    }

    function injectStyle() {
        if ($(`#${CONFIG.styleId}`)) return;

        const style = document.createElement("style");
        style.id = CONFIG.styleId;
        style.textContent = `
      #${CONFIG.panelId} {
        position: fixed;
        top: 80px;
        right: 24px;
        width: 360px;
        max-height: 76vh;
        overflow: hidden;
        z-index: 999999;
        background: #fff;
        color: #222;
        border: 1px solid #d8d8d8;
        border-radius: 12px;
        box-shadow: 0 6px 24px rgba(0,0,0,.18);
        font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
        font-size: 13px;
      }

      #${CONFIG.panelId}.is-collapsed {
        width: 180px;
        max-height: none;
      }

      #${CONFIG.panelId}.is-collapsed .nc-header {
        padding: 10px 12px;
        border-bottom: 0;
      }

      #${CONFIG.panelId}.is-collapsed .nc-body {
        display: none;
      }

      #${CONFIG.panelId}.is-collapsed .nc-export-all {
        display: none;
      }

      #${CONFIG.panelId} .nc-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 14px;
        border-bottom: 1px solid #eee;
        font-weight: 700;
      }

      #${CONFIG.panelId} .nc-actions {
        display: flex;
        gap: 6px;
        align-items: center;
      }

      #${CONFIG.panelId} .nc-toggle,
      #${CONFIG.panelId} .nc-close {
        border: 0;
        background: transparent;
        color: #222;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 0 2px;
      }

      #${CONFIG.panelId} .nc-export-all {
        border: 1px solid #ddd;
        border-radius: 4px;
        background: #fff;
        color: #222;
        cursor: pointer;
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
        padding: 3px 5px;
      }

      #${CONFIG.panelId} .nc-export-all:disabled {
        color: #aaa;
        cursor: not-allowed;
      }

      #${CONFIG.panelId} .nc-body {
        padding: 12px 14px;
        max-height: calc(76vh - 48px);
        overflow: auto;
      }

      #${CONFIG.panelId} .nc-meta {
        margin-bottom: 10px;
        color: #555;
        line-height: 1.6;
      }

      #${CONFIG.panelId} table {
        width: 100%;
        border-collapse: collapse;
      }

      #${CONFIG.panelId} th,
      #${CONFIG.panelId} td {
        padding: 7px 4px;
        border-bottom: 1px solid #eee;
        text-align: left;
      }

      #${CONFIG.panelId} th:last-child,
      #${CONFIG.panelId} td:last-child {
        text-align: right;
      }

      #${CONFIG.panelId} .nc-writer-row {
        cursor: pointer;
      }

      #${CONFIG.panelId} .nc-writer-row:hover {
        background: #f7f7f7;
      }

      #${CONFIG.panelId} .nc-posts {
        display: none;
        padding: 8px 4px 12px 12px;
        background: #fafafa;
        border-bottom: 1px solid #eee;
      }

      #${CONFIG.panelId} .nc-posts.is-open {
        display: block;
      }

      #${CONFIG.panelId} .nc-post {
        margin: 0 0 8px;
        line-height: 1.45;
      }

      #${CONFIG.panelId} .nc-post a {
        color: #0969da;
        text-decoration: none;
      }

      #${CONFIG.panelId} .nc-post a:hover {
        text-decoration: underline;
      }

      #${CONFIG.panelId} .nc-small {
        color: #777;
        font-size: 12px;
      }

      #${CONFIG.panelId} .nc-status {
        margin: 8px 0 10px;
        color: #666;
        font-size: 12px;
        line-height: 1.45;
      }

      #${CONFIG.panelId} .nc-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 180px;
        color: #666;
        font-size: 14px;
      }

      #${CONFIG.panelId} .nc-spinner {
        width: 18px;
        height: 18px;
        margin-right: 10px;
        border: 2px solid #ddd;
        border-top-color: #03c75a;
        border-radius: 50%;
        animation: nc-spin .7s linear infinite;
      }

      @keyframes nc-spin {
        to {
          transform: rotate(360deg);
        }
      }

      #${CONFIG.buttonId} {
        position: fixed;
        right: 24px;
        top: 80px;
        width: 180px;
        z-index: 999998;
        padding: 10px 12px;
        border: 1px solid #d8d8d8;
        border-radius: 12px;
        background: #fff;
        color: #222;
        box-shadow: 0 6px 24px rgba(0,0,0,.18);
        cursor: pointer;
        font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
        font-size: 13px;
        font-weight: 700;
        text-align: left;
      }
    `;

        document.head.appendChild(style);
    }

    function createPostHtml(post) {
        return `
      <div class="nc-post">
        <a href="${post.url}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(post.title)}
        </a>
        <div class="nc-small">
          ${escapeHtml(post.date)} · 조회 ${escapeHtml(post.view)}
        </div>
      </div>
    `;
    }

    function createWriterHtml(stat, index) {
        return `
      <tr class="nc-writer-row" data-index="${index}">
        <td title="${escapeHtml(stat.writerId)}">
            ${escapeHtml(stat.writerName)}
        </td>
        <td>${stat.count}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding:0;">
          <div class="nc-posts" data-posts="${index}">
            ${stat.posts.map(createPostHtml).join("")}
          </div>
        </td>
      </tr>
    `;
    }

    function makeCsvValue(value) {
        return `"${String(value ?? "").replace(/"/g, '""')}"`;
    }

    function makeCsvContent(items) {
        const stats = createWriterStats(items);
        const rows = [
            ["순위", "작성자명", "작성자ID", "글 수"],
            ...stats.map((stat, index) => [
                index + 1,
                stat.writerName,
                stat.writerId,
                stat.count,
            ]),
        ];

        return rows.map((row) => row.map(makeCsvValue).join(",")).join("\r\n");
    }

    function makeCsvFilename() {
        const keyword = getSearchKeyword()
            .trim()
            .replace(/[\\/:*?"<>|]+/g, "_")
            .replace(/\s+/g, "_")
            || "search";

        const date = new Date().toISOString().slice(0, 10);
        return `naver-cafe-stats_${keyword}_${date}.csv`;
    }

    function downloadCsv(items) {
        const csv = `\uFEFF${makeCsvContent(items)}`;
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = makeCsvFilename();
        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);
    }

    function createPanelHtml(items, stats, isCollapsed, options = {}) {
        const sourceLabel = options.sourceLabel || "현재 페이지";
        const periodText = getSearchPeriodText();
        const statsCsvDisabledReason = getStatsCsvDisabledReason();
        const canExportAll = !statsCsvDisabledReason;
        const totalText = options.totalArticleCount
            ? `<div>검색 결과 전체 글: <b>${options.totalArticleCount}</b>개</div>`
            : "";
        const statusText = options.statusText || statsCsvDisabledReason;

        return `
      <div class="nc-header">
        <span>카페 검색 통계</span>
        <div class="nc-actions">
          <button type="button" class="nc-export-all" title="${escapeHtml(getExportAllTitle())}" ${canExportAll ? "" : "disabled"}>모두수집</button>
          <button type="button" class="nc-toggle" title="${isCollapsed ? "펼치기" : "접기"}">
            ${isCollapsed ? "+" : "−"}
          </button>
          <button type="button" class="nc-close" title="닫기">×</button>
        </div>
      </div>

      <div class="nc-body">
        <div class="nc-meta">
          <div>키워드: <b>${escapeHtml(getSearchKeyword())}</b></div>
          <div>기간: <b>${escapeHtml(periodText)}</b></div>
          <div>수집 범위: <b>${escapeHtml(sourceLabel)}</b></div>
          ${totalText}
          <div>수집 글: <b>${items.length}</b>개</div>
          <div>작성자 수: <b>${stats.length}</b>명</div>
        </div>
        <div class="nc-status" aria-live="polite">${escapeHtml(statusText)}</div>

        <table>
          <thead>
            <tr>
              <th>작성자</th>
              <th>글 수</th>
            </tr>
          </thead>
          <tbody>
            ${stats.map(createWriterHtml).join("")}
          </tbody>
        </table>
      </div>
    `;
    }

    function getPanelState() {
        const panel = $(`#${CONFIG.panelId}`);

        return {
            exists: Boolean(panel),
            isCollapsed: panel
                ? panel.classList.contains("is-collapsed")
                : false,
        };
    }

    function showLoading() {
        const panel = $(`#${CONFIG.panelId}`);
        if (!panel || panel.classList.contains("is-collapsed")) return;

        const body = $(".nc-body", panel);
        if (!body) return;

        isInternalUpdate = true;

        body.innerHTML = `
    <div class="nc-loading">
      <div class="nc-spinner"></div>
      통계 갱신 중...
    </div>
    `;

        queueMicrotask(() => {
            isInternalUpdate = false;
        });
    }

    function setPanelStatus(panel, message) {
        const status = $(".nc-status", panel);
        if (status) {
            status.textContent = message || "";
        }
    }

    function bindPanelEvents(panel, items, options = {}) {
        const toggleBtn = $(".nc-toggle", panel);
        const exportAllBtn = $(".nc-export-all", panel);
        const closeBtn = $(".nc-close", panel);

        exportAllBtn.addEventListener("click", async () => {
            if (isCollectingAll) return;
            if (!hasSpecificDateRange()) {
                setPanelStatus(panel, getStatsCsvDisabledReason());
                return;
            }

            isCollectingAll = true;
            exportAllBtn.disabled = true;
            setPanelStatus(panel, "모든 검색 결과 수집 준비 중...");

            try {
                const result = await collectAllArticles(({ page, count, totalArticleCount }) => {
                    const total = totalArticleCount ? ` / ${totalArticleCount}` : "";
                    setPanelStatus(panel, `${page}페이지 수집 중... ${count}${total}개`);
                });

                downloadCsv(result.items);

                renderPanel({
                    items: result.items,
                    isCollapsed: false,
                    sourceLabel: "API 모두 수집",
                    totalArticleCount: result.totalArticleCount,
                    statusText: `전체 CSV 다운로드 완료: ${result.items.length}개`,
                });
            } catch (error) {
                console.error("[NCafeStats] collect all failed", error);
                setPanelStatus(panel, `모두 수집 실패: ${error.message}`);
                exportAllBtn.disabled = false;
            } finally {
                isCollectingAll = false;
            }
        });

        toggleBtn.addEventListener("click", () => {
            const collapsed = panel.classList.toggle("is-collapsed");
            if (collapsed) {
                panel.remove();
                showFloatingButton();
                return;
            }

            toggleBtn.textContent = collapsed ? "+" : "−";
            toggleBtn.title = collapsed ? "펼치기" : "접기";
        });

        closeBtn.addEventListener("click", () => {
            panel.remove();
            showFloatingButton();
        });

        $$(".nc-writer-row", panel).forEach((row) => {
            row.addEventListener("click", () => {
                const posts = $(`[data-posts="${row.dataset.index}"]`, panel);
                posts?.classList.toggle("is-open");
            });
        });
    }

    function renderPanel(options = {}) {
        if (!isSearchResultsPage()) return;

        injectStyle();

        const previousState = getPanelState();
        const shouldCollapse = options.isCollapsed ?? previousState.isCollapsed;

        isInternalUpdate = true;

        $(`#${CONFIG.panelId}`)?.remove();
        $(`#${CONFIG.buttonId}`)?.remove();

        const items = options.items || parseArticles();
        const stats = createWriterStats(items);

        const panel = document.createElement("div");
        panel.id = CONFIG.panelId;
        panel.innerHTML = createPanelHtml(items, stats, shouldCollapse, options);

        if (shouldCollapse) {
            panel.classList.add("is-collapsed");
        }

        document.body.appendChild(panel);
        bindPanelEvents(panel, items, options);

        queueMicrotask(() => {
            isInternalUpdate = false;
        });
    }

    function showFloatingButton() {
        if (!isSearchResultsPage() || $(`#${CONFIG.buttonId}`)) return;

        injectStyle();

        const button = document.createElement("button");
        button.id = CONFIG.buttonId;
        button.type = "button";
        button.textContent = "카페 통계 보기";
        button.addEventListener("click", () => renderPanel({ isCollapsed: false }));

        document.body.appendChild(button);
    }
    function waitForResults() {
        if (!isSearchResultsPage()) return;

        showFloatingButton();

        const timer = setInterval(() => {
            if (!$(CONFIG.resultSelector)) return;

            clearInterval(timer);

            wasBoardVisible = Boolean($(CONFIG.boardSelector));

            if (!CONFIG.defaultClosed) {
                renderPanel();
            }
        }, 500);

        setTimeout(() => {
            clearInterval(timer);
        }, CONFIG.initialWaitMs);
    }
    let wasBoardVisible = Boolean($(CONFIG.boardSelector));
    let refreshTimer = null;

    function observeResultChanges() {
        const handleBoardStateChange = debounce(() => {
            if (isInternalUpdate) return;
            if (isCollectingAll) return;
            if (!isSearchResultsPage()) return;

            const hasPanel = Boolean($(`#${CONFIG.panelId}`));
            const isBoardVisible = Boolean($(CONFIG.boardSelector));

            if (!hasPanel) {
                wasBoardVisible = isBoardVisible;
                return;
            }

            // 목록 영역이 사라진 순간: 로딩 표시
            if (wasBoardVisible && !isBoardVisible) {
                showLoading();
                wasBoardVisible = false;
                return;
            }

            // 목록 영역이 다시 나타난 순간: 통계 갱신
            if (!wasBoardVisible && isBoardVisible) {
                wasBoardVisible = true;

                clearTimeout(refreshTimer);
                refreshTimer = setTimeout(() => {
                    if (!$(CONFIG.resultSelector)) return;
                    renderPanel();
                }, CONFIG.loadingDelayMs);
            }
        }, CONFIG.observeDebounceMs);

        const observer = new MutationObserver(handleBoardStateChange);

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }
    function init() {
        if (!isSearchResultsPage()) return;

        console.log("[NCafeStats] init", {
            url: location.href,
            hasSearchQuery: hasSearchQuery(),
            articles: document.querySelectorAll("table.article-table tbody tr a.article").length,
            board: Boolean(document.querySelector(".article-board")),
        });

        injectStyle();

        waitForResults();
        observeResultChanges();
    }

    init();
})();
