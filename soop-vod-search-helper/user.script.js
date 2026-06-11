// ==UserScript==
// @name         SOOP Clip/Catch Creator Stats
// @version      0.8.17
// @description  SOOP 방송국 클립/캐치 검색 결과에서 생성자별 통계를 표시합니다.
// @match        https://www.sooplive.com/station/*
// @run-at       document-start
// @grant        none
// @license      MIT
// @author       gd0live
// ==/UserScript==

(function () {
    "use strict";

    const CONFIG = {
        panelId: "soop-creator-stat-panel",
        buttonId: "soop-creator-stat-floating-btn",
        styleId: "soop-creator-stat-style",
        defaultCollapsed: true,
        apiWaitTimeoutMs: 5000,
        fullCollectDelayMs: 250,
        fullCollectMaxPages: 200,

        apiHosts: [
            "api-channel.sooplive.com",
            "chapi.sooplive.com",
        ],

        debug: false,
    };

    let itemsByKey = new Map();
    let statsByUserId = new Map();

    let currentContextKey = "";
    let currentPageStateKey = "";
    let isWaitingForApi = true;
    let hasApiWaitTimedOut = false;
    let apiWaitTimerId = 0;
    let lastApiUrl = "";
    let isCollectingAll = false;
    let isInternalRequest = false;
    let isPanelDismissed = false;
    let collectAllStatus = "";

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

    const SOOP_BADGE_SVG_BY_CLASS = {
        ObjectFanBadgeBigFan: `<div aria-label="ObjectFanBadgeBigFan" class="icon-wrap __soopui__Icon-module__icon___J5RH5" style="--fill-color: none; --stroke-color: none; width: 14px; height: 14px;"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"> <rect width="14" height="14" rx="3" fill="#D65B8F"></rect> <path d="M3 4.8231C3 6.10451 4.06083 6.91326 5.39475 6.91326C6.79169 6.91326 7.8 6.073 7.8 4.8231C7.8 3.55221 6.79169 2.64893 5.39475 2.64893C4.00832 2.64893 3 3.57321 3 4.8231ZM4.19737 4.8231C4.19737 4.1824 4.73304 3.66774 5.39475 3.66774C6.14048 3.66774 6.59212 4.1824 6.59212 4.8231C6.59212 5.39028 6.12998 5.89444 5.39475 5.89444C4.68053 5.89444 4.19737 5.4428 4.19737 4.8231Z" fill="white"></path> <path d="M11 7.1734V2.07489H9.80001V3.17489H8.33335L8.35529 4.31044H9.80001V5.33102H8.35529L8.33335 6.39549H9.80001V7.1734H11ZM11 11.9251V10.9045H5.87518V10.2351H11V7.62333H4.52539V8.63294H9.72704V9.30235H4.58026V11.9251H11Z" fill="white"></path> </svg> </div>`,
        ObjectSubscribeBadge: `<div aria-label="ObjectSubscribeBadge" class="icon-wrap __soopui__Icon-module__icon___J5RH5" style="--fill-color: none; --stroke-color: none; width: 14px; height: 14px;"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"> <circle cx="7" cy="7" r="7" fill="#EF565F"></circle> <path d="M9.79999 8.21963C9.93296 8.24449 10.0603 8.26053 10.1821 8.26053C11.2029 8.26053 11.76 7.54746 11.76 6.67915C11.76 5.81083 11.2029 5.11053 10.1821 5.11053C10.0837 5.11053 9.98101 5.12176 9.87604 5.13781" stroke="white" stroke-width="0.682372"></path> <path d="M3.16062 7.92665C3.29475 9.5617 4.66867 10.8514 6.33775 10.8514C7.73313 10.8514 9.00548 9.9507 9.47112 8.70043C9.53604 8.52613 9.66002 8.01145 9.66002 7.75233V5.1176V4.34329C9.66002 4.07175 9.43989 3.85138 9.16835 3.85138H3.6417C3.37015 3.85138 3.15002 4.07175 3.15002 4.34329L3.15004 7.43515L3.16062 7.92665Z" fill="white" stroke="white" stroke-width="0.578668" stroke-linejoin="round"></path> <path fill-rule="evenodd" clip-rule="evenodd" d="M6.78373 5.46424C6.61206 5.17859 6.19851 5.17859 6.02685 5.46424L5.61007 6.15775L4.82265 6.34038C4.49832 6.4156 4.37052 6.80946 4.58876 7.06123L5.11861 7.67247L5.04872 8.47885C5.01994 8.81099 5.35451 9.05441 5.66105 8.92436L6.40529 8.60862L7.14952 8.92436C7.45606 9.05441 7.79063 8.81099 7.76185 8.47885L7.69196 7.67247L8.22181 7.06123C8.44005 6.80946 8.31226 6.4156 7.98792 6.34038L7.2005 6.15775L6.78373 5.46424Z" fill="#EF565F"></path> </svg> </div>`,
        ObjectFanBadgeSupporter: `<div aria-label="ObjectFanBadgeSupporter" class="icon-wrap __soopui__Icon-module__icon___J5RH5" style="--fill-color: none; --stroke-color: none; width: 14px; height: 14px;"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"> <rect width="14" height="14" rx="3" fill="#9379BD"></rect> <path d="M5.5152 8.20501C5.5152 8.44501 5.55853 8.64835 5.6452 8.81501C5.73186 8.98168 5.8452 9.11835 5.9852 9.22501C6.13186 9.32501 6.30186 9.40168 6.4952 9.45501C6.68853 9.50168 6.88853 9.52501 7.0952 9.52501C7.2352 9.52501 7.3852 9.51501 7.5452 9.49501C7.7052 9.46835 7.8552 9.42168 7.9952 9.35501C8.1352 9.28835 8.25186 9.19835 8.3452 9.08501C8.43853 8.96501 8.4852 8.81501 8.4852 8.63501C8.4852 8.44168 8.42186 8.28501 8.2952 8.16501C8.1752 8.04501 8.0152 7.94501 7.8152 7.86501C7.6152 7.78501 7.38853 7.71501 7.1352 7.65501C6.88186 7.59501 6.6252 7.52835 6.3652 7.45501C6.09853 7.38835 5.83853 7.30835 5.5852 7.21501C5.33186 7.11501 5.1052 6.98835 4.9052 6.83501C4.7052 6.68168 4.54186 6.49168 4.4152 6.26501C4.2952 6.03168 4.2352 5.75168 4.2352 5.42501C4.2352 5.05835 4.31186 4.74168 4.4652 4.47501C4.6252 4.20168 4.83186 3.97501 5.0852 3.79501C5.33853 3.61501 5.6252 3.48168 5.9452 3.39501C6.2652 3.30835 6.5852 3.26501 6.9052 3.26501C7.27853 3.26501 7.6352 3.30835 7.9752 3.39501C8.32186 3.47501 8.62853 3.60835 8.8952 3.79501C9.16186 3.98168 9.37186 4.22168 9.5252 4.51501C9.6852 4.80168 9.7652 5.15168 9.7652 5.56501H8.2452C8.23186 5.35168 8.1852 5.17501 8.1052 5.03501C8.03186 4.89501 7.93186 4.78501 7.8052 4.70501C7.67853 4.62501 7.53186 4.56835 7.3652 4.53501C7.2052 4.50168 7.02853 4.48501 6.8352 4.48501C6.70853 4.48501 6.58186 4.49835 6.4552 4.52501C6.32853 4.55168 6.21186 4.59835 6.1052 4.66501C6.0052 4.73168 5.92186 4.81501 5.8552 4.91501C5.78853 5.01501 5.7552 5.14168 5.7552 5.29501C5.7552 5.43501 5.78186 5.54835 5.8352 5.63501C5.88853 5.72168 5.99186 5.80168 6.1452 5.87501C6.3052 5.94835 6.52186 6.02168 6.7952 6.09501C7.0752 6.16835 7.43853 6.26168 7.8852 6.37501C8.01853 6.40168 8.20186 6.45168 8.4352 6.52501C8.6752 6.59168 8.91186 6.70168 9.1452 6.85501C9.37853 7.00835 9.57853 7.21501 9.7452 7.47501C9.91853 7.72835 10.0052 8.05501 10.0052 8.45501C10.0052 8.78168 9.94186 9.08501 9.8152 9.36501C9.68853 9.64501 9.49853 9.88835 9.2452 10.095C8.99853 10.295 8.68853 10.4517 8.3152 10.565C7.94853 10.6783 7.52186 10.735 7.0352 10.735C6.64186 10.735 6.25853 10.685 5.8852 10.585C5.51853 10.4917 5.19186 10.3417 4.9052 10.135C4.6252 9.92835 4.40186 9.66501 4.2352 9.34501C4.06853 9.02501 3.98853 8.64501 3.9952 8.20501H5.5152Z" fill="white"></path> </svg> </div>`,
        ObjectFanBadge: `<div aria-label="ObjectFanBadge" class="icon-wrap __soopui__Icon-module__icon___J5RH5" style="--fill-color: none; --stroke-color: none; width: 14px; height: 14px;"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"> <rect width="14" height="14" rx="3" fill="#75AA5C"></rect> <path d="M4.48999 3.42999H9.50999V4.74999H6.05999V6.39999H9.04999V7.61999H6.05999V10.57H4.48999V3.42999Z" fill="white"></path> </svg> </div>`,
    };

    function log(...args) {
        if (CONFIG.debug) {
            console.log("[SOOPCreatorStats]", ...args);
        }
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function firstNonEmpty(...values) {
        for (const value of values) {
            if (value !== undefined && value !== null && String(value).trim() !== "") {
                return value;
            }
        }

        return "";
    }

    function getParamAny(params, ...names) {
        for (const name of names) {
            const value = params.get(name);

            if (value !== null) {
                return value;
            }
        }

        return "";
    }

    function valuesConflict(a, b) {
        return Boolean(a && b && a !== b);
    }

    function isTargetPage() {
        return /^\/station\/[^/]+\/vod\/clip(?:\/|$)/.test(location.pathname)
            || /^\/station\/[^/]+\/catch(?:\/|$)/.test(location.pathname);
    }

    function getPageTypeFromLocation() {
        if (/^\/station\/[^/]+\/catch(?:\/|$)/.test(location.pathname)) {
            return "catch";
        }

        if (/^\/station\/[^/]+\/vod\/clip(?:\/|$)/.test(location.pathname)) {
            return "clip";
        }

        return "";
    }

    function getStationIdFromLocation() {
        return location.pathname.match(/^\/station\/([^/]+)/)?.[1] || "";
    }

    function isConfiguredApiHost(hostname) {
        return CONFIG.apiHosts.includes(hostname);
    }

    function getApiType(urlLike) {
        try {
            const url = new URL(urlLike, location.href);

            if (!isConfiguredApiHost(url.hostname)) {
                return "";
            }

            if (
                /^\/v1\.1\/channel\/[^/]+\/vod\/clip(?:\/[^/]+)?$/.test(url.pathname)
            ) {
                return "clip";
            }

            if (
                /^\/api\/[^/]+\/vods\/catch(?:\/[^/]+)?$/.test(url.pathname) ||
                /^\/v1\.1\/channel\/[^/]+\/vod\/catch(?:\/[^/]+)?$/.test(url.pathname)
            ) {
                return "catch";
            }

            return "";
        } catch {
            return "";
        }
    }

    function isTargetApi(urlLike) {
        const apiType = getApiType(urlLike);
        if (!apiType) return false;

        const pageType = getPageTypeFromLocation();

        if (!pageType) return false;
        if (apiType !== pageType) return false;

        return true;
    }

    function getStationIdFromApiUrl(urlLike) {
        try {
            const url = new URL(urlLike, location.href);
            const apiType = getApiType(urlLike);

            if (apiType === "clip") {
                return url.pathname.match(/^\/v1\.1\/channel\/([^/]+)\/vod\/clip(?:\/[^/]+)?$/)?.[1] || "";
            }

            if (apiType === "catch") {
                return url.pathname.match(/^\/api\/([^/]+)\/vods\/catch(?:\/[^/]+)?$/)?.[1]
                    || url.pathname.match(/^\/v1\.1\/channel\/([^/]+)\/vod\/catch(?:\/[^/]+)?$/)?.[1]
                    || "";
            }

            return "";
        } catch {
            return "";
        }
    }

    function getCreatedByFromApiUrl(urlLike) {
        try {
            const url = new URL(urlLike, location.href);
            const apiType = getApiType(urlLike);

            if (apiType === "clip") {
                return url.pathname.match(/^\/v1\.1\/channel\/[^/]+\/vod\/clip\/([^/]+)$/)?.[1] || "";
            }

            if (apiType === "catch") {
                return url.pathname.match(/^\/api\/[^/]+\/vods\/catch\/([^/]+)$/)?.[1]
                    || url.pathname.match(/^\/v1\.1\/channel\/[^/]+\/vod\/catch\/([^/]+)$/)?.[1]
                    || "";
            }

            return "";
        } catch {
            return "";
        }
    }

    function getContextFromApiUrl(urlLike) {
        const url = new URL(urlLike, location.href);
        const params = url.searchParams;
        const apiType = getApiType(urlLike);

        return {
            type: apiType,
            stationId: getStationIdFromApiUrl(urlLike),
            startDate: getParamAny(params, "startDate", "start_date"),
            endDate: getParamAny(params, "endDate", "end_date"),
            keyword: getParamAny(params, "keyword", "search"),
            orderBy: getParamAny(params, "orderBy", "orderby", "sort"),
            period: getParamAny(params, "period"),
            createdBy: getParamAny(params, "createdBy", "created_by") || getCreatedByFromApiUrl(urlLike),
            perPage: getParamAny(params, "perPage", "per_page"),
            page: params.get("page") || "",
            field: params.get("field") || "",
            pathname: url.pathname,
        };
    }

    function getContextKeyFromApiUrl(urlLike) {
        const ctx = getContextFromApiUrl(urlLike);

        return [
            ctx.type,
            ctx.stationId,
            ctx.startDate,
            ctx.endDate,
            ctx.keyword,
            ctx.orderBy,
            ctx.period,
            ctx.createdBy,
            ctx.perPage,
            ctx.field,
            ctx.pathname,
        ].join("|");
    }

    function getCurrentPageMeta() {
        const url = new URL(location.href);
        const params = url.searchParams;
        const pageType = getPageTypeFromLocation();

        return {
            type: pageType,
            stationId: getStationIdFromLocation(),
            startDate: getParamAny(params, "startDate", "start_date"),
            endDate: getParamAny(params, "endDate", "end_date"),
            keyword: getParamAny(params, "keyword", "search"),
            orderBy: getParamAny(params, "orderBy", "orderby", "sort"),
            period: getParamAny(params, "period"),
            createdBy: getParamAny(params, "createdBy", "created_by"),
        };
    }

    function getPageStateKey() {
        const meta = getCurrentPageMeta();

        return [
            meta.type,
            meta.stationId,
            meta.startDate,
            meta.endDate,
            meta.keyword,
            meta.orderBy,
            meta.period,
            meta.createdBy,
            location.pathname,
            location.search,
        ].join("|");
    }

    function isApiForCurrentPage(urlLike) {
        const ctx = getContextFromApiUrl(urlLike);
        const meta = getCurrentPageMeta();

        if (ctx.type !== meta.type) return false;
        if (ctx.stationId !== meta.stationId) return false;

        if (valuesConflict(ctx.keyword, meta.keyword)) return false;
        if (valuesConflict(ctx.orderBy, meta.orderBy)) return false;
        if (valuesConflict(ctx.period, meta.period)) return false;
        if (valuesConflict(ctx.createdBy, meta.createdBy)) return false;
        if (valuesConflict(ctx.startDate, meta.startDate)) return false;
        if (valuesConflict(ctx.endDate, meta.endDate)) return false;

        return true;
    }

    function resetStats() {
        itemsByKey = new Map();
        statsByUserId = new Map();
    }

    function clearApiWaitTimer() {
        if (!apiWaitTimerId) return;

        clearTimeout(apiWaitTimerId);
        apiWaitTimerId = 0;
    }

    function startApiWaitTimer() {
        clearApiWaitTimer();
        hasApiWaitTimedOut = false;

        apiWaitTimerId = setTimeout(() => {
            apiWaitTimerId = 0;

            if (!isTargetPage() || !isWaitingForApi || statsByUserId.size) return;

            hasApiWaitTimedOut = true;
            renderPanel();
        }, CONFIG.apiWaitTimeoutMs);
    }

    function removeUi() {
        clearApiWaitTimer();
        $(`#${CONFIG.panelId}`)?.remove();
        $(`#${CONFIG.buttonId}`)?.remove();
    }

    function markWaitingForApi() {
        if (!isTargetPage()) {
            removeUi();
            return;
        }

        if (isPanelDismissed) return;

        isWaitingForApi = true;
        startApiWaitTimer();
        resetStats();
        currentContextKey = "";
        collectAllStatus = "";
        currentPageStateKey = getPageStateKey();

        const panel = $(`#${CONFIG.panelId}`);

        if (panel) {
            renderPanel();
        } else {
            showClosedPanel();
        }
    }

    function getTitle(raw, apiType) {
        const candidates = apiType === "catch"
            ? [raw.titleName, raw.catchTitle, raw.catch_title]
            : [raw.titleName];

        return String(firstNonEmpty(...candidates)).replace(/\s+/g, " ").trim();
    }

    function getUserId(raw) {
        return String(firstNonEmpty(
            raw.userId,
            raw?.copyright?.userId
        )).trim();
    }

    function getUserNick(raw) {
        return String(firstNonEmpty(
            raw.userNick,
            raw?.copyright?.userNick
        )).trim();
    }

    function getItemNo(raw, apiType) {
        const candidates = apiType === "catch"
            ? [raw.titleNo, raw.catchNo, raw.catch_no]
            : [raw.titleNo];

        return String(firstNonEmpty(...candidates)).trim();
    }

    function getDate(raw) {
        return String(firstNonEmpty(
            raw.regDate
        )).trim();
    }

    function getView(raw) {
        return firstNonEmpty(
            raw?.count?.readCnt,
            raw?.count?.vodReadCnt
        );
    }

    function isActiveBadgeValue(value) {
        return value === true || value === 1 || value === "1" || value === "Y";
    }

    function getCreatorBadges(raw) {
        return {
            isTopFan: isActiveBadgeValue(raw?.badge?.isTopFan),
            isFan: isActiveBadgeValue(raw?.badge?.isFan),
            isSubscribe: isActiveBadgeValue(raw?.badge?.isSubscribe),
            isSupport: isActiveBadgeValue(raw?.badge?.isSupport),
        };
    }

    function mergeBadges(target, source) {
        return {
            isTopFan: Boolean(target?.isTopFan || source?.isTopFan),
            isFan: Boolean(target?.isFan || source?.isFan),
            isSubscribe: Boolean(target?.isSubscribe || source?.isSubscribe),
            isSupport: Boolean(target?.isSupport || source?.isSupport),
        };
    }

    function parseViewCount(value) {
        if (value === null || value === undefined || value === "") return 0;

        const normalized = String(value).replace(/,/g, "").trim();
        const count = Number(normalized);

        return Number.isFinite(count) ? count : 0;
    }

    function formatNumber(value) {
        return Number(value || 0).toLocaleString("ko-KR");
    }

    function getItemUrl(raw, apiType, itemNo) {
        if (apiType === "clip") {
            return itemNo ? `https://vod.sooplive.com/player/${itemNo}` : "";
        }

        if (apiType === "catch") {
            return firstNonEmpty(
                raw.url,
                raw.linkUrl,
                raw.link_url,
                raw.shareUrl,
                raw.share_url,
                raw.catchUrl,
                raw.catch_url,
                itemNo ? `https://vod.sooplive.com/player/${itemNo}/catch` : ""
            );
        }

        return "";
    }

    function normalizeItem(raw, apiType) {
        const itemNo = getItemNo(raw, apiType);
        const title = getTitle(raw, apiType);
        const userId = getUserId(raw);
        const userNick = getUserNick(raw);

        return {
            type: apiType,
            itemNo,
            title,
            userNick,
            userId,
            regDate: getDate(raw),
            view: getView(raw),
            badges: getCreatorBadges(raw),
            url: getItemUrl(raw, apiType, itemNo),
        };
    }

    function itemLooksValid(item) {
        return Boolean(item && item.userId && (item.title || item.itemNo));
    }

    function findItemArray(json) {
        if (Array.isArray(json?.contents)) return json.contents;
        if (Array.isArray(json?.data)) return json.data;

        const candidates = [
            json?.data?.list,
            json?.data?.items,
            json?.data?.contents,
            json?.list,
            json?.items,
            json?.contents,
            json?.result?.list,
            json?.result?.items,
            json?.result?.contents,
        ];

        for (const value of candidates) {
            if (Array.isArray(value)) return value;
        }

        return [];
    }

    function rebuildStats() {
        statsByUserId.clear();

        for (const item of itemsByKey.values()) {
            if (!item.userId) continue;

            const stat = statsByUserId.get(item.userId) || {
                userId: item.userId,
                userNick: item.userNick,
                count: 0,
                viewTotal: 0,
                badges: item.badges,
                items: [],
            };

            stat.count += 1;
            stat.viewTotal += parseViewCount(item.view);
            stat.badges = mergeBadges(stat.badges, item.badges);
            stat.items.push(item);

            if (item.userNick) {
                stat.userNick = item.userNick;
            }

            statsByUserId.set(item.userId, stat);
        }
    }

    function addItems(rawItems, apiType) {
        let changed = false;

        for (const raw of rawItems) {
            const item = normalizeItem(raw, apiType);

            if (!itemLooksValid(item)) {
                log("skip invalid item", item, raw);
                continue;
            }

            const dedupeKey = item.itemNo
                ? `${apiType}:${item.itemNo}`
                : `${apiType}:${item.userId}:${item.title}:${item.regDate}`;

            if (itemsByKey.has(dedupeKey)) {
                continue;
            }

            itemsByKey.set(dedupeKey, item);
            changed = true;
        }

        rebuildStats();

        if (changed || $(`#${CONFIG.panelId}`)) {
            renderPanel();
        }
    }

    function getSortedStats() {
        return [...statsByUserId.values()].sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            if (b.viewTotal !== a.viewTotal) return b.viewTotal - a.viewTotal;

            const aName = a.userNick || a.userId || "";
            const bName = b.userNick || b.userId || "";

            return String(aName).localeCompare(String(bName), "ko");
        });
    }

    function getStationUrl(userId) {
        return `https://www.sooplive.com/station/${encodeURIComponent(userId)}`;
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
        width: 400px;
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

      #${CONFIG.panelId}.is-collapsed .sc-header {
        padding: 10px 12px;
        border-bottom: 0;
      }

      #${CONFIG.panelId}.is-collapsed .sc-body {
        display: none;
      }

      #${CONFIG.panelId}.is-collapsed .sc-export-all {
        display: none;
      }

      #${CONFIG.panelId} .sc-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 14px;
        border-bottom: 1px solid #eee;
        cursor: pointer;
        font-weight: 700;
      }

      #${CONFIG.panelId} .sc-actions {
        display: flex;
        gap: 6px;
        align-items: center;
      }

      #${CONFIG.panelId} .sc-toggle,
      #${CONFIG.panelId} .sc-close,
      #${CONFIG.panelId} .sc-export-all {
        border: 0;
        background: transparent;
        color: #222;
        cursor: pointer;
        line-height: 1;
      }

      #${CONFIG.panelId} .sc-toggle,
      #${CONFIG.panelId} .sc-close {
        font-size: 18px;
        padding: 0 2px;
      }

      #${CONFIG.panelId} .sc-export-all {
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 700;
        padding: 3px 5px;
      }

      #${CONFIG.panelId} .sc-export-all:disabled {
        color: #aaa;
        cursor: not-allowed;
      }

      #${CONFIG.panelId} .sc-body {
        padding: 12px 14px;
        max-height: calc(76vh - 48px);
        overflow: auto;
      }

      #${CONFIG.panelId} .sc-meta {
        margin-bottom: 10px;
        color: #555;
        line-height: 1.6;
      }

      #${CONFIG.panelId} table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      #${CONFIG.panelId} th,
      #${CONFIG.panelId} td {
        padding: 7px 4px;
        border-bottom: 1px solid #eee;
        text-align: left;
        vertical-align: top;
      }

      #${CONFIG.panelId} th:nth-child(n+2),
      #${CONFIG.panelId} td:nth-child(n+2) {
        text-align: right;
        white-space: nowrap;
      }

      #${CONFIG.panelId} th:nth-child(1),
      #${CONFIG.panelId} td:nth-child(1) {
        width: auto;
      }

      #${CONFIG.panelId} th:nth-child(2),
      #${CONFIG.panelId} td:nth-child(2) {
        width: 58px;
      }

      #${CONFIG.panelId} th:nth-child(3),
      #${CONFIG.panelId} td:nth-child(3) {
        width: 86px;
      }

      #${CONFIG.panelId} th:last-child,
      #${CONFIG.panelId} td:last-child {
        text-align: right;
      }

      #${CONFIG.panelId} .sc-user-row {
        cursor: pointer;
      }

      #${CONFIG.panelId} .sc-user-row:hover {
        background: #f7f7f7;
      }

      #${CONFIG.panelId} .sc-user-link {
        color: #222;
        text-decoration: none;
        font-weight: 700;
      }

      #${CONFIG.panelId} .sc-user-link:hover {
        color: #0969da;
        text-decoration: underline;
      }

      #${CONFIG.panelId} .sc-user-name {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 4px;
        min-width: 0;
      }

      #${CONFIG.panelId} .sc-user-link {
        flex: 0 1 auto;
        min-width: 0;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #${CONFIG.panelId} .sc-badges {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 2px;
      }

      #${CONFIG.panelId} .sc-soop-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 14px;
        flex: 0 0 auto;
      }

      #${CONFIG.panelId} .sc-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 16px;
        height: 16px;
        padding: 0 3px;
        border: 1px solid transparent;
        border-radius: 3px;
        font-size: 10px;
        font-weight: 700;
        line-height: 1;
        white-space: nowrap;
      }

      #${CONFIG.panelId} .sc-badge-topfan {
        color: #9a3412;
        background: #ffedd5;
        border-color: #fed7aa;
      }

      #${CONFIG.panelId} .sc-badge-fan {
        color: #166534;
        background: #dcfce7;
        border-color: #bbf7d0;
      }

      #${CONFIG.panelId} .sc-badge-subscribe {
        color: #1d4ed8;
        background: #dbeafe;
        border-color: #bfdbfe;
      }

      #${CONFIG.panelId} .sc-badge-support {
        color: #7e22ce;
        background: #f3e8ff;
        border-color: #e9d5ff;
      }

      #${CONFIG.panelId} .sc-items {
        display: none;
        padding: 8px 4px 12px 12px;
        background: #fafafa;
        border-bottom: 1px solid #eee;
      }

      #${CONFIG.panelId} .sc-items.is-open {
        display: block;
      }

      #${CONFIG.panelId} .sc-item {
        margin: 0 0 8px;
        line-height: 1.45;
      }

      #${CONFIG.panelId} .sc-item a {
        color: #0969da;
        text-decoration: none;
      }

      #${CONFIG.panelId} .sc-item a:hover {
        text-decoration: underline;
      }

      #${CONFIG.panelId} .sc-small {
        color: #777;
        font-size: 12px;
      }

      #${CONFIG.panelId} .sc-empty,
      #${CONFIG.panelId} .sc-loading {
        padding: 28px 0;
        text-align: center;
        color: #666;
      }

      #${CONFIG.panelId} .sc-status {
        margin-top: 8px;
        color: #0969da;
        font-size: 12px;
      }

    `;

        document.head.appendChild(style);
    }

    function createItemHtml(item) {
        const title = item.title || "(제목 없음)";
        const url = item.url || "#";

        const metaParts = [];

        if (item.regDate) {
            metaParts.push(escapeHtml(item.regDate));
        }

        if (item.view !== "") {
            metaParts.push(`조회 ${escapeHtml(item.view)}`);
        }

        return `
      <div class="sc-item">
        ${
            item.url
                ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
                : `<span>${escapeHtml(title)}</span>`
        }
        <div class="sc-small">${metaParts.join(" · ")}</div>
      </div>
    `;
    }

    function normalizeSoopBadgeHtml(html, title) {
        const template = document.createElement("template");
        template.innerHTML = String(html || "").trim();

        const badge = template.content.firstElementChild;

        if (!badge) return "";

        badge.classList.add("sc-soop-badge");
        badge.setAttribute("aria-label", title);
        badge.setAttribute("title", title);

        return badge.outerHTML;
    }

    function getEmbeddedSoopBadgeHtml(objectClassName, title) {
        return normalizeSoopBadgeHtml(SOOP_BADGE_SVG_BY_CLASS[objectClassName], title);
    }

    function getExistingSoopBadgeHtml(objectClassName, title) {
        const selectors = [
            `[aria-label="${objectClassName}"]`,
            `[title="${objectClassName}"]`,
            `[class*="${objectClassName}"]`,
        ];
        const badge = document.querySelector(selectors.join(","));

        if (!badge) return "";

        return normalizeSoopBadgeHtml(badge.outerHTML, title);
    }

    function getSoopBadgeHtml(objectClassName, title) {
        return getEmbeddedSoopBadgeHtml(objectClassName, title)
            || getExistingSoopBadgeHtml(objectClassName, title);
    }

    function createTextBadgeHtml(className, label, title) {
        return `<span class="sc-badge sc-badge-${escapeHtml(className)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
    }

    function createBadgeHtml(badges) {
        const definitions = [];

        if (badges?.isTopFan) {
            definitions.push(["topfan", "ObjectFanBadgeBigFan", "열혈", "열혈팬"]);
        }

        if (badges?.isSubscribe) {
            definitions.push(["subscribe", "ObjectSubscribeBadge", "구독", "구독자"]);
        }

        if (badges?.isSupport) {
            definitions.push(["support", "ObjectFanBadgeSupporter", "서포터", "서포터"]);
        }

        if (badges?.isFan && !badges?.isTopFan && !badges?.isSupport) {
            definitions.push(["fan", "ObjectFanBadge", "팬", "팬"]);
        }

        const html = definitions
            .map(([className, objectClassName, label, title]) => (
                getSoopBadgeHtml(objectClassName, title)
                || createTextBadgeHtml(className, label, title)
            ))
            .join("");

        return html ? `<span class="sc-badges">${html}</span>` : "";
    }

    function createUserHtml(stat, index) {
        const displayName = stat.userNick || "(닉네임 없음)";
        const stationUrl = getStationUrl(stat.userId);
        const badgeHtml = createBadgeHtml(stat.badges);

        return `
      <tr class="sc-user-row" data-index="${index}">
        <td title="${escapeHtml(displayName)}">
          <div class="sc-user-name">
            <a
              class="sc-user-link"
              href="${escapeHtml(stationUrl)}"
              target="_blank"
              rel="noopener noreferrer"
              title="방송국 열기"
            >${escapeHtml(displayName)}</a>
            ${badgeHtml}
          </div>
        </td>
        <td>${formatNumber(stat.count)}</td>
        <td>${formatNumber(stat.viewTotal)}</td>
      </tr>
      <tr>
        <td colspan="3" style="padding:0;">
          <div class="sc-items" data-items="${index}">
            ${stat.items.map(createItemHtml).join("")}
          </div>
        </td>
      </tr>
    `;
    }

    function createPanelHtml(stats, isCollapsed) {
        const meta = getCurrentPageMeta();
        const viewTotal = stats.reduce((sum, stat) => sum + (stat.viewTotal || 0), 0);

        const periodText = meta.startDate || meta.endDate
            ? `${meta.startDate || "-"} ~ ${meta.endDate || "-"}`
            : meta.period || "-";

        const typeLabel = meta.type === "catch" ? "캐치" : "클립";
        const fullCsvDisabledReason = getFullStatsCsvDisabledReason();
        const statusText = collectAllStatus || fullCsvDisabledReason;

        let bodyHtml;

        if (hasApiWaitTimedOut && !stats.length) {
            bodyHtml = `<div class="sc-loading">통계 수집에 실패했습니다. 새로고침해보세요.</div>`;
        } else if (isWaitingForApi && !stats.length) {
            bodyHtml = `<div class="sc-loading">통계 갱신 대기 중...</div>`;
        } else if (stats.length) {
            bodyHtml = `
        <table>
          <thead>
            <tr>
              <th>닉네임</th>
              <th>${typeLabel} 수</th>
              <th>조회 수 합계</th>
            </tr>
          </thead>
          <tbody>
            ${stats.map(createUserHtml).join("")}
          </tbody>
        </table>
      `;
        } else {
            bodyHtml = `<div class="sc-empty">수집된 ${typeLabel}가 없습니다.</div>`;
        }

        return `
      <div class="sc-header">
        <span>SOOP ${typeLabel} 통계</span>
        <div class="sc-actions">
          <button type="button" class="sc-export-all" title="${escapeHtml(fullCsvDisabledReason || "직접 지정한 기간의 전체 통계 CSV 다운로드")}" ${canDownloadFullStatsCsv() ? "" : "disabled"}>
            모두 수집
          </button>
          <button type="button" class="sc-toggle" title="${isCollapsed ? "펼치기" : "접기"}">
            ${isCollapsed ? "+" : "−"}
          </button>
          <button type="button" class="sc-close" title="닫기">×</button>
        </div>
      </div>

      <div class="sc-body">
        <div class="sc-meta">
          <div>기간: <b>${escapeHtml(periodText)}</b></div>
          <div>키워드: <b>${escapeHtml(meta.keyword || "-")}</b></div>
          <div>수집 ${typeLabel}: <b>${formatNumber(itemsByKey.size)}</b>개</div>
          <div>조회 수 합계: <b>${formatNumber(viewTotal)}</b>회</div>
          <div>생성자 수: <b>${formatNumber(stats.length)}</b>명</div>
          ${statusText ? `<div class="sc-status">${escapeHtml(statusText)}</div>` : ""}
        </div>

        ${bodyHtml}
      </div>
    `;
    }

    function toCsvCell(value) {
        const text = String(value ?? "");

        return `"${text.replace(/"/g, '""')}"`;
    }

    function getCsvFileNameByKind(kind) {
        const meta = getCurrentPageMeta();
        const now = new Date();
        const stamp = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, "0"),
            String(now.getDate()).padStart(2, "0"),
            String(now.getHours()).padStart(2, "0"),
            String(now.getMinutes()).padStart(2, "0"),
            String(now.getSeconds()).padStart(2, "0"),
        ].join("");

        return [
            "soop",
            meta.stationId || "station",
            meta.type || "vod",
            meta.createdBy || "all",
            kind,
            stamp,
        ].join("-") + ".csv";
    }

    function createStatsCsvText(stats) {
        const rows = [[
            "type",
            "creator_id",
            "creator_nick",
            "count",
            "view_total",
            "is_top_fan",
            "is_fan",
            "is_subscribe",
            "is_support",
            "station_url",
        ]];

        for (const stat of stats) {
            rows.push([
                getPageTypeFromLocation(),
                stat.userId,
                stat.userNick,
                stat.count,
                stat.viewTotal,
                stat.badges?.isTopFan ? 1 : 0,
                stat.badges?.isFan ? 1 : 0,
                stat.badges?.isSubscribe ? 1 : 0,
                stat.badges?.isSupport ? 1 : 0,
                getStationUrl(stat.userId),
            ]);
        }

        return "\uFEFF" + rows.map((row) => row.map(toCsvCell).join(",")).join("\r\n");
    }

    function downloadTextAsCsv(text, fileName) {
        const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function hasSpecificDateRange(urlLike) {
        if (!urlLike) return false;

        const ctx = getContextFromApiUrl(urlLike);

        return Boolean(ctx.startDate && ctx.endDate);
    }

    function canDownloadFullStatsCsv() {
        return Boolean(lastApiUrl && !isCollectingAll && hasSpecificDateRange(lastApiUrl));
    }

    function getFullStatsCsvDisabledReason() {
        if (isCollectingAll) return "전체 수집 중입니다.";
        if (!lastApiUrl) return "전체 CSV를 만들 API를 아직 감지하지 못했습니다.";
        if (!hasSpecificDateRange(lastApiUrl)) return "전체 CSV는 직접 지정한 시작일/종료일이 있을 때만 받을 수 있습니다.";

        return "";
    }

    function getPageParamName(url) {
        if (url.searchParams.has("page")) return "page";
        if (url.searchParams.has("pageNo")) return "pageNo";
        if (url.searchParams.has("nPageNo")) return "nPageNo";

        return "page";
    }

    function getPerPageFromUrl(url) {
        const value =
            url.searchParams.get("perPage") ||
            url.searchParams.get("per_page") ||
            url.searchParams.get("nListCnt") ||
            "";

        return Number(value) || 0;
    }

    function buildStatsFromItems(items) {
        const map = new Map();

        for (const item of items) {
            if (!item.userId) continue;

            const stat = map.get(item.userId) || {
                userId: item.userId,
                userNick: item.userNick,
                count: 0,
                viewTotal: 0,
                badges: item.badges,
            };

            stat.count += 1;
            stat.viewTotal += parseViewCount(item.view);
            stat.badges = mergeBadges(stat.badges, item.badges);

            if (item.userNick) {
                stat.userNick = item.userNick;
            }

            map.set(item.userId, stat);
        }

        return [...map.values()].sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            if (b.viewTotal !== a.viewTotal) return b.viewTotal - a.viewTotal;

            const aName = a.userNick || a.userId || "";
            const bName = b.userNick || b.userId || "";

            return String(aName).localeCompare(String(bName), "ko");
        });
    }

    async function collectAllAndDownloadStatsCsv() {
        if (isCollectingAll) return;

        if (!lastApiUrl) {
            collectAllStatus = "전체 CSV를 만들 API를 아직 감지하지 못했습니다.";
            renderPanel();
            return;
        }

        if (!hasSpecificDateRange(lastApiUrl)) {
            collectAllStatus = "전체 CSV는 직접 지정한 시작일/종료일이 있을 때만 받을 수 있습니다.";
            renderPanel();
            return;
        }

        isCollectingAll = true;
        collectAllStatus = "전체 수집 준비 중...";
        renderPanel();

        try {
            const baseUrl = new URL(lastApiUrl, location.href);
            const apiType = getApiType(baseUrl.href);
            const pageParamName = getPageParamName(baseUrl);
            const perPage = getPerPageFromUrl(baseUrl);
            const itemsByDedupeKey = new Map();

            for (let page = 1; page <= CONFIG.fullCollectMaxPages; page += 1) {
                baseUrl.searchParams.set(pageParamName, String(page));
                collectAllStatus = `전체 수집 중... ${page}페이지 / ${itemsByDedupeKey.size}개`;
                renderPanel();

                isInternalRequest = true;
                const response = await fetch(baseUrl.href, { credentials: "include" });
                isInternalRequest = false;

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const json = await response.json();
                const rawItems = findItemArray(json);

                for (const raw of rawItems) {
                    const item = normalizeItem(raw, apiType);

                    if (!itemLooksValid(item)) continue;

                    const dedupeKey = item.itemNo
                        ? `${apiType}:${item.itemNo}`
                        : `${apiType}:${item.userId}:${item.title}:${item.regDate}`;

                    itemsByDedupeKey.set(dedupeKey, item);
                }

                if (!rawItems.length || (perPage && rawItems.length < perPage)) {
                    break;
                }

                await delay(CONFIG.fullCollectDelayMs);
            }

            const stats = buildStatsFromItems(itemsByDedupeKey.values());

            downloadTextAsCsv(createStatsCsvText(stats), getCsvFileNameByKind("stats-all"));
            collectAllStatus = `전체 수집 완료: ${itemsByDedupeKey.size}개 / ${stats.length}명`;
        } catch (e) {
            isInternalRequest = false;
            console.warn("[SOOPCreatorStats] full collect failed", e);
            collectAllStatus = "전체 수집 실패";
        } finally {
            isCollectingAll = false;
            renderPanel();
        }
    }

    function getPanelState(defaultCollapsed = CONFIG.defaultCollapsed) {
        const panel = $(`#${CONFIG.panelId}`);

        return {
            exists: Boolean(panel),
            isCollapsed: panel
                ? panel.classList.contains("is-collapsed")
                : defaultCollapsed,
        };
    }

    function setPanelCollapsed(panel, collapsed) {
        const toggleBtn = $(".sc-toggle", panel);

        panel.classList.toggle("is-collapsed", collapsed);

        if (toggleBtn) {
            toggleBtn.textContent = collapsed ? "+" : "−";
            toggleBtn.title = collapsed ? "펼치기" : "접기";
        }
    }

    function bindPanelEvents(panel) {
        const header = $(".sc-header", panel);
        const exportAllBtn = $(".sc-export-all", panel);
        const closeBtn = $(".sc-close", panel);

        header?.addEventListener("click", (event) => {
            if (event.target instanceof Element && event.target.closest(".sc-close, .sc-export-all")) return;
            setPanelCollapsed(panel, !panel.classList.contains("is-collapsed"));
        });

        exportAllBtn?.addEventListener("click", collectAllAndDownloadStatsCsv);

        closeBtn?.addEventListener("click", () => {
            isPanelDismissed = true;
            removeUi();
        });

        $$(".sc-user-row", panel).forEach((row) => {
            row.addEventListener("click", (event) => {
                if (event.target.closest("a")) return;

                const items = $(`[data-items="${row.dataset.index}"]`, panel);
                items?.classList.toggle("is-open");
            });
        });
    }

    function renderPanel() {
        if (!isTargetPage()) {
            removeUi();
            return;
        }

        if (isPanelDismissed) {
            removeUi();
            return;
        }

        injectStyle();

        const previousState = getPanelState();

        $(`#${CONFIG.panelId}`)?.remove();
        $(`#${CONFIG.buttonId}`)?.remove();

        const stats = getSortedStats();

        const panel = document.createElement("div");
        panel.id = CONFIG.panelId;
        panel.innerHTML = createPanelHtml(stats, previousState.isCollapsed);
        setPanelCollapsed(panel, previousState.isCollapsed);

        document.body.appendChild(panel);
        bindPanelEvents(panel);
    }

    function showClosedPanel() {
        if (!isTargetPage()) {
            removeUi();
            return;
        }

        if (isPanelDismissed) return;

        if ($(`#${CONFIG.panelId}`)) return;

        renderPanel();
    }

    async function handleResponse(url, responseText) {
        if (!isTargetApi(url)) return;

        try {
            if (!isApiForCurrentPage(url)) {
                log("skip stale API response", url);
                return;
            }

            const apiType = getApiType(url);
            const nextContextKey = getContextKeyFromApiUrl(url);

            if (nextContextKey !== currentContextKey) {
                currentContextKey = nextContextKey;
                collectAllStatus = "";
                resetStats();
            }

            lastApiUrl = String(new URL(url, location.href));

            const json = JSON.parse(responseText);
            const rawItems = findItemArray(json);

            isWaitingForApi = false;
            hasApiWaitTimedOut = false;
            clearApiWaitTimer();

            log("API matched", apiType, url, rawItems.length, json);

            addItems(rawItems, apiType);
        } catch (e) {
            console.warn("[SOOPCreatorStats] API parse failed", url, e);
        }
    }

    function hookFetch() {
        const originalFetch = window.fetch;

        window.fetch = async function (...args) {
            const response = await originalFetch.apply(this, args);

            try {
                if (isInternalRequest) {
                    return response;
                }

                const url = String(args[0]?.url || args[0] || "");

                if (isTargetApi(url)) {
                    const text = await response.clone().text();
                    await handleResponse(url, text);
                }
            } catch (e) {
                console.warn("[SOOPCreatorStats] fetch hook failed", e);
            }

            return response;
        };
    }

    function hookXHR() {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            this.__soopCreatorStatsUrl = String(url);
            return originalOpen.call(this, method, url, ...rest);
        };

        XMLHttpRequest.prototype.send = function (...args) {
            this.addEventListener("load", function () {
                try {
                    const url = this.__soopCreatorStatsUrl || "";

                    if (isTargetApi(url)) {
                        handleResponse(url, this.responseText || "");
                    }
                } catch (e) {
                    console.warn("[SOOPCreatorStats] XHR hook failed", e);
                }
            });

            return originalSend.apply(this, args);
        };
    }

    function hookHistoryChange() {
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function (...args) {
            const result = originalPushState.apply(this, args);
            window.dispatchEvent(new Event("soop-creator-stats-location-change"));
            return result;
        };

        history.replaceState = function (...args) {
            const result = originalReplaceState.apply(this, args);
            window.dispatchEvent(new Event("soop-creator-stats-location-change"));
            return result;
        };

        window.addEventListener("popstate", () => {
            window.dispatchEvent(new Event("soop-creator-stats-location-change"));
        });

        window.addEventListener("soop-creator-stats-location-change", () => {
            if (!isTargetPage()) {
                removeUi();
                resetStats();
                currentContextKey = "";
                currentPageStateKey = "";
                isWaitingForApi = true;
                isPanelDismissed = false;
                return;
            }

            const nextPageStateKey = getPageStateKey();

            if (nextPageStateKey === currentPageStateKey) {
                return;
            }

            currentPageStateKey = nextPageStateKey;
            isPanelDismissed = false;
            markWaitingForApi();
        });
    }

    function init() {
        hookFetch();
        hookXHR();
        hookHistoryChange();

        if (!isTargetPage()) {
            removeUi();
            return;
        }

        injectStyle();
        currentPageStateKey = getPageStateKey();
        showClosedPanel();
        startApiWaitTimer();

        setTimeout(() => {
            if (!isTargetPage()) {
                removeUi();
                return;
            }

            if (!$(`#${CONFIG.panelId}`)) {
                showClosedPanel();
            }
        }, 1000);
    }

    init();
})();
