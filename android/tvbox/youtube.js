// ynoTV: YouTube site for FongMi/TV (QuickJS).
// Lists and searches YouTube through the InnerTube web API. Playback returns the
// watch URL; FongMi/TV's built-in YouTube extractor (NewPipe) resolves the stream.

const API = "https://www.youtube.com/youtubei/v1/search?prettyPrint=false";
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

    async function post(body) {
        return await net.json(API, {
            method: "POST",
            postType: "json",
            data: body,
            headers: {"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"},
            timeout: 15000,
        });
    }

    function walk(o, vids, conts) {
        if (Array.isArray(o)) { for (const v of o) walk(v, vids, conts); return; }
        if (!o || typeof o !== "object") return;
        if (o.videoRenderer) vids.push(o.videoRenderer);
        if (o.continuationItemRenderer) {
            const t = o.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
            if (t) conts.push(t);
        }
        for (const k in o) if (k !== "videoRenderer") walk(o[k], vids, conts);
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
        if (page === 1) body = {context: context(), query: q, params: VIDEO_FILTER};
        else if (list[page - 2]) body = {context: context(), continuation: list[page - 2]};
        else return {page, pagecount: page, list: []};
        const data = await post(body);
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

    function home(filter) {
        return {class: classes.map(([name, q]) => ({type_id: q, type_name: name}))};
    }

    async function homeVod() {
        try { return {list: (await query(classes[0][1], "1")).list}; } catch (e) { return {list: []}; }
    }

    async function category(tid, pg, filter, extend) {
        return await query(tid, pg);
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
        vod.vod_play_from = "YouTube";
        vod.vod_play_url = "播放$" + url;
        return {list: [vod]};
    }

    function play(flag, id, vipFlags) {
        return {parse: 0, url: String(id)};
    }

    return {init, home, homeVod, category, detail, search, play};
}

export default createSpider;
