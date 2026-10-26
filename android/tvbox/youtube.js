// ynoTV: YouTube site for FongMi/TV (QuickJS).
// Lists and searches YouTube through the InnerTube web API. Playback returns the
// watch URL; FongMi/TV's built-in YouTube extractor (NewPipe) resolves the stream.

const YT = "https://www.youtube.com";
const API = YT + "/youtubei/v1/search?prettyPrint=false";
const BROWSE = YT + "/youtubei/v1/browse?prettyPrint=false";
const LOGIN_URL = "https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=" +
    encodeURIComponent(YT + "/signin?action_handle_signin=true&app=desktop&hl=zh-HK&next=" + encodeURIComponent(YT + "/"));
const FEEDS = [["推荐", "feed:FEwhat_to_watch"], ["订阅", "feed:FEsubscriptions"], ["历史", "feed:FEhistory"]];
const ACCOUNT = "account";
const VIDEO_FILTER = "EgIQAQ==";
const CLASSES = [
    ["热门", "热门"],
    ["香港新闻", "香港新闻"],
    ["粤语歌", "粤语歌"],
    ["音乐MV", "official music video"],
    ["综艺", "综艺"],
    ["电影解说", "电影解说"],
    ["纪录片", "纪录片"],
    ["科技", "科技评测"],
    ["直播", "live"],
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

function createSpider(site = {}) {
    let hl = "zh-HK";
    let gl = "HK";
    let classes = CLASSES;
    const tokens = {};
    const cache = {};

    function init(ext) {
        let o = {};
        try { o = typeof ext === "string" && ext ? JSON.parse(ext) : (ext || {}); } catch (e) { o = {}; }
        if (o.hl) hl = String(o.hl);
        if (o.gl) gl = String(o.gl);
        if (Array.isArray(o.classes) && o.classes.length) classes = o.classes.map((c) => [String(c), String(c)]);
    }

    function context() {
        return {client: {clientName: "WEB", clientVersion: "2.20251020.00.00", hl, gl}};
    }

    function cookies() {
        try { return String(net.getCookie(YT + "/") || ""); } catch (e) { return ""; }
    }

    function cookieValue(all, name) {
        for (const part of all.split(";")) {
            const i = part.indexOf("=");
            if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
        }
        return "";
    }

    function sapisid() {
        const c = cookies();
        return cookieValue(c, "SAPISID") || cookieValue(c, "__Secure-3PAPISID");
    }

    function loggedIn() {
        return !!sapisid();
    }

    function headers() {
        const h = {"Content-Type": "application/json", "User-Agent": UA, "Origin": YT, "X-Origin": YT};
        const sid = sapisid();
        if (sid) {
            const ts = Math.floor(Date.now() / 1000);
            h["Cookie"] = cookies();
            h["Authorization"] = `SAPISIDHASH ${ts}_${sha1(ts + " " + sid + " " + YT)}`;
            h["X-Goog-AuthUser"] = "0";
        }
        return h;
    }

    async function post(url, body) {
        return await net.json(url, {method: "POST", postType: "json", data: body, headers: headers(), timeout: 15000});
    }

    function walk(o, vids, conts) {
        if (Array.isArray(o)) { for (const v of o) walk(v, vids, conts); return; }
        if (!o || typeof o !== "object") return;
        if (o.videoRenderer) vids.push(o.videoRenderer);
        if (o.lockupViewModel) { const v = fromLockup(o.lockupViewModel); if (v) vids.push(v); return; }
        if (o.continuationItemRenderer) {
            const t = o.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
            if (t) conts.push(t);
        }
        for (const k in o) if (k !== "videoRenderer") walk(o[k], vids, conts);
    }

    function findText(o, key) {
        if (Array.isArray(o)) { for (const v of o) { const r = findText(v, key); if (r) return r; } return ""; }
        if (!o || typeof o !== "object") return "";
        if (o[key] && typeof o[key].text === "string") return o[key].text;
        for (const k in o) { const r = findText(o[k], key); if (r) return r; }
        return "";
    }

    function fromLockup(l) {
        if (!l.contentId || (l.contentType && l.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO")) return null;
        const meta = l.metadata?.lockupMetadataViewModel || {};
        const sources = l.contentImage?.thumbnailViewModel?.image?.sources || [];
        const owner = meta.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content || "";
        const badge = findText(l.contentImage, "thumbnailBadgeViewModel");
        return {
            videoId: l.contentId,
            title: {simpleText: meta.title?.content || ""},
            thumbnail: {thumbnails: sources},
            lengthText: badge && /\d:\d/.test(badge) ? {simpleText: badge} : null,
            ownerText: {simpleText: owner},
        };
    }

    function text(t) {
        if (!t) return "";
        if (t.simpleText) return t.simpleText;
        if (Array.isArray(t.runs)) return t.runs.map((r) => r.text).join("");
        return "";
    }

    function card(v) {
        const thumbs = v.thumbnail?.thumbnails || [];
        const pic = thumbs.length ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;
        const len = text(v.lengthText);
        const owner = text(v.ownerText) || text(v.longBylineText);
        return {
            vod_id: `https://www.youtube.com/watch?v=${v.videoId}`,
            vod_name: text(v.title),
            vod_pic: pic.split("?")[0],
            vod_remarks: len || "直播",
            vod_director: owner,
            style: {type: "rect", ratio: 1.78},
        };
    }

    async function query(q, pg) {
        const page = Math.max(1, parseInt(pg || "1", 10) || 1);
        const list = tokens[q] || (tokens[q] = []);
        let body;
        const feed = q.startsWith("feed:");
        if (feed && !loggedIn()) return {page: 1, pagecount: 1, list: [loginCard()]};
        if (page === 1) body = feed ? {context: context(), browseId: q.slice(5)} : {context: context(), query: q, params: VIDEO_FILTER};
        else if (list[page - 2]) body = {context: context(), continuation: list[page - 2]};
        else return {page, pagecount: page, list: []};
        const data = await post(feed ? BROWSE : API, body);
        const vids = [];
        const conts = [];
        walk(data, vids, conts);
        const next = conts.length ? conts[conts.length - 1] : "";
        list[page - 1] = next;
        const seen = {};
        const items = [];
        for (const v of vids) {
            if (!v.videoId || seen[v.videoId]) continue;
            seen[v.videoId] = 1;
            const c = card(v);
            cache[c.vod_id] = c;
            items.push(c);
        }
        return {page, pagecount: next ? page + 1 : page, limit: items.length, total: 9999, list: items};
    }

    function loginCard() {
        return {vod_id: "action/login", vod_name: "登录 YouTube 账号", vod_remarks: "登录后可看推荐、订阅和历史", action: "login", style: {type: "list"}};
    }

    function accountCards() {
        if (!loggedIn()) return [loginCard()];
        return [
            {vod_id: "action/status", vod_name: "已登录 YouTube", vod_remarks: "推荐、订阅、历史已开启", action: "status", style: {type: "list"}},
            {vod_id: "action/login", vod_name: "重新登录 / 切换账号", vod_remarks: "", action: "login", style: {type: "list"}},
            {vod_id: "action/logout", vod_name: "退出登录", vod_remarks: "清除 YouTube Cookie", action: "logout", style: {type: "list"}},
        ];
    }

    function home(filter) {
        const list = (loggedIn() ? FEEDS : []).concat(classes);
        const cls = list.map(([name, q]) => ({type_id: q, type_name: name}));
        if (loggedIn()) cls.push({type_id: ACCOUNT, type_name: "账号"});
        else cls.unshift({type_id: ACCOUNT, type_name: "登录"});
        return {class: cls};
    }

    async function homeVod() {
        let list = [];
        try { list = (await query(loggedIn() ? FEEDS[0][1] : classes[0][1], "1")).list; } catch (e) { }
        return {list: loggedIn() ? list : [loginCard()].concat(list)};
    }

    async function category(tid, pg, filter, extend) {
        if (tid === ACCOUNT) return {page: 1, pagecount: 1, list: accountCards()};
        return await query(tid, pg);
    }

    function action(value) {
        if (value === "login") {
            return {web: {url: LOGIN_URL, cookie: [{url: YT + "/", keys: ["SAPISID"]}, {url: YT + "/", keys: ["__Secure-3PAPISID"]}]}};
        }
        if (value === "logout") {
            for (const name of ["SAPISID", "__Secure-3PAPISID", "__Secure-1PAPISID", "APISID", "HSID", "SSID", "SID", "__Secure-1PSID", "__Secure-3PSID", "LOGIN_INFO"]) {
                try { net.setCookie(YT + "/", `${name}=; Domain=.youtube.com; Path=/; Max-Age=0`); } catch (e) { }
                try { net.setCookie(YT + "/", `${name}=; Path=/; Max-Age=0`); } catch (e) { }
            }
            for (const k in tokens) delete tokens[k];
            return {msg: loggedIn() ? "退出失败，请在设置里清除 WebView 数据" : "已退出 YouTube，返回首页刷新"};
        }
        if (value === "status") return {msg: loggedIn() ? "YouTube 已登录" : "YouTube 未登录"};
        return {msg: "不支持此操作"};
    }

    async function search(key, quick, pg = "1") {
        return await query(String(key || "").trim(), pg);
    }

    async function detail(id) {
        const url = String(id);
        let vod = cache[url] ? {...cache[url]} : null;
        if (!vod) {
            vod = {vod_id: url, vod_name: "YouTube"};
            try {
                const o = await net.json("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(url), {timeout: 10000});
                vod.vod_name = o.title || vod.vod_name;
                vod.vod_director = o.author_name || "";
                vod.vod_pic = o.thumbnail_url || "";
            } catch (e) { }
        }
        delete vod.style;
        vod.vod_play_from = "YouTube$$$备用线路";
        vod.vod_play_url = "播放$" + url + "$$$播放$direct:" + url;
        return {list: [vod]};
    }

    const CLIENTS = [
        {name: "IOS", id: "5", version: "20.10.4",
            ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
            extra: {deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82"}},
        {name: "ANDROID_VR", id: "28", version: "1.62.27",
            ua: "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
            extra: {deviceMake: "Oculus", deviceModel: "Quest 3", androidSdkVersion: 32, osName: "Android", osVersion: "12L"}},
    ];

    function videoId(url) {
        const m = String(url).match(/[?&]v=([\w-]{11})/) || String(url).match(/(?:youtu\.be\/|shorts\/|live\/)([\w-]{11})/);
        return m ? m[1] : "";
    }

    async function direct(url) {
        const vid = videoId(url);
        for (const c of CLIENTS) {
            try {
                const body = {videoId: vid, contentCheckOk: true, racyCheckOk: true,
                    context: {client: Object.assign({clientName: c.name, clientVersion: c.version, hl, gl}, c.extra)}};
                const o = await net.json(YT + "/youtubei/v1/player?prettyPrint=false", {method: "POST", postType: "json", data: body, timeout: 15000,
                    headers: {"Content-Type": "application/json", "User-Agent": c.ua, "X-YouTube-Client-Name": c.id, "X-YouTube-Client-Version": c.version}});
                const sd = (o && o.streamingData) || {};
                if (sd.hlsManifestUrl) return {parse: 0, url: sd.hlsManifestUrl, header: {"User-Agent": c.ua}};
                const muxed = (sd.formats || []).filter((f) => f.url).sort((a, b) => (b.height || 0) - (a.height || 0));
                if (muxed.length) return {parse: 0, url: muxed[0].url, header: {"User-Agent": c.ua}};
            } catch (e) { }
        }
        return null;
    }

    async function play(flag, id, vipFlags) {
        const s = String(id);
        if (s.startsWith("direct:")) {
            const url = s.slice(7);
            const r = await direct(url);
            return r || {parse: 0, url};
        }
        return {parse: 0, url: s};
    }

    return {init, home, homeVod, category, detail, search, play, action};
}

function sha1(msg) {
    const bytes = [];
    const utf8 = unescape(encodeURIComponent(msg));
    for (let i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i));
    const len = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (len >>> (i * 8)) & 0xff);
    let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
    const w = new Array(80);
    for (let off = 0; off < bytes.length; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
        for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
        let a = h0, b = h1, c = h2, d = h3, e = h4;
        for (let i = 0; i < 80; i++) {
            let f, k;
            if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
            else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
            else { f = b ^ c ^ d; k = 0xCA62C1D6; }
            const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
            e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
        }
        h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    return [h0, h1, h2, h3, h4].map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

export default createSpider;
