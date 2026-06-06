// ==UserScript==
// @name         SOOP Clip/Catch Creator Stats
// @version      0.8.7
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

        clipApiHost: "api-channel.sooplive.com",
        catchApiHost: "chapi.sooplive.com",

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
    let collectAllStatus = "";

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

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

    function getApiType(urlLike) {
        try {
            const url = new URL(urlLike, location.href);

            if (
                url.hostname === CONFIG.clipApiHost &&
                /^\/v1\.1\/channel\/[^/]+\/vod\/clip(?:\/[^/]+)?$/.test(url.pathname)
            ) {
                return "clip";
            }

            if (
                url.hostname === CONFIG.catchApiHost &&
                /^\/api\/[^/]+\/vods\/catch\/[^/]+$/.test(url.pathname)
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
                return url.pathname.match(/^\/api\/([^/]+)\/vods\/catch\/[^/]+$/)?.[1] || "";
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
                return url.pathname.match(/^\/api\/[^/]+\/vods\/catch\/([^/]+)$/)?.[1] || "";
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

    function getTitle(raw) {
        return String(firstNonEmpty(
            raw.titleName,
            raw.title_name,
            raw.title,
            raw.clipTitle,
            raw.clip_title,
            raw.catchTitle,
            raw.catch_title,
            raw.vodTitle,
            raw.vod_title,
            raw.subject,
            raw.contents,
            raw.content
        )).replace(/\s+/g, " ").trim();
    }

    function getUserId(raw) {
        return String(firstNonEmpty(
            raw.userId,
            raw.user_id,
            raw?.copyright?.userId,
            raw?.copyright?.user_id,
            raw?.badge?.userId,
            raw?.badge?.user_id
        )).trim();
    }

    function getUserNick(raw) {
        return String(firstNonEmpty(
            raw.userNick,
            raw.user_nick,
            raw.nickName,
            raw.nickname,
            raw.nick,
            raw?.copyright?.userNick,
            raw?.copyright?.user_nick
        )).trim();
    }

    function getItemNo(raw) {
        return String(firstNonEmpty(
            raw.titleNo,
            raw.title_no,
            raw.vodNo,
            raw.vod_no,
            raw.catchNo,
            raw.catch_no,
            raw.id
        )).trim();
    }

    function getDate(raw) {
        return String(firstNonEmpty(
            raw.regDate,
            raw.reg_date,
            raw.createdAt,
            raw.created_at,
            raw.createDate,
            raw.create_date
        )).trim();
    }

    function getView(raw) {
        return firstNonEmpty(
            raw?.count?.readCnt,
            raw?.count?.read_cnt,
            raw?.count?.vodReadCnt,
            raw?.count?.vod_read_cnt,
            raw.viewCnt,
            raw.view_cnt,
            raw.readCnt,
            raw.read_cnt
        );
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
        const itemNo = getItemNo(raw);
        const title = getTitle(raw);
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
                items: [],
            };

            stat.count += 1;
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
      }

      #${CONFIG.panelId} th,
      #${CONFIG.panelId} td {
        padding: 7px 4px;
        border-bottom: 1px solid #eee;
        text-align: left;
        vertical-align: top;
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

    function createUserHtml(stat, index) {
        const displayName = stat.userNick || "(닉네임 없음)";
        const stationUrl = getStationUrl(stat.userId);

        return `
      <tr class="sc-user-row" data-index="${index}">
        <td title="${escapeHtml(displayName)}">
          <a
            class="sc-user-link"
            href="${escapeHtml(stationUrl)}"
            target="_blank"
            rel="noopener noreferrer"
            title="방송국 열기"
          >${escapeHtml(displayName)}</a>
        </td>
        <td>${stat.count}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding:0;">
          <div class="sc-items" data-items="${index}">
            ${stat.items.map(createItemHtml).join("")}
          </div>
        </td>
      </tr>
    `;
    }

    function createPanelHtml(stats, isCollapsed) {
        const meta = getCurrentPageMeta();

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
          <div>수집 ${typeLabel}: <b>${itemsByKey.size}</b>개</div>
          <div>생성자 수: <b>${stats.length}</b>명</div>
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
            "station_url",
        ]];

        for (const stat of stats) {
            rows.push([
                getPageTypeFromLocation(),
                stat.userId,
                stat.userNick,
                stat.count,
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
            };

            stat.count += 1;

            if (item.userNick) {
                stat.userNick = item.userNick;
            }

            map.set(item.userId, stat);
        }

        return [...map.values()].sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;

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
            panel.remove();
            showClosedPanel();
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
                return;
            }

            const nextPageStateKey = getPageStateKey();

            if (nextPageStateKey === currentPageStateKey) {
                return;
            }

            currentPageStateKey = nextPageStateKey;
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
