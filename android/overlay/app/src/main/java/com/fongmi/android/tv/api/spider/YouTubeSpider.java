package com.fongmi.android.tv.api.spider;

import android.content.Context;

import com.fongmi.android.tv.bean.Site;
import com.fongmi.android.tv.impl.NewPipeImpl;
import com.github.catvod.crawler.Spider;
import com.google.gson.JsonParser;

import org.json.JSONArray;
import org.json.JSONObject;
import org.schabi.newpipe.extractor.Image;
import org.schabi.newpipe.extractor.InfoItem;
import org.schabi.newpipe.extractor.ListExtractor;
import org.schabi.newpipe.extractor.NewPipe;
import org.schabi.newpipe.extractor.Page;
import org.schabi.newpipe.extractor.ServiceList;
import org.schabi.newpipe.extractor.localization.ContentCountry;
import org.schabi.newpipe.extractor.localization.Localization;
import org.schabi.newpipe.extractor.services.youtube.linkHandler.YoutubeSearchQueryHandlerFactory;
import org.schabi.newpipe.extractor.stream.StreamInfo;
import org.schabi.newpipe.extractor.stream.StreamInfoItem;
import org.schabi.newpipe.extractor.stream.StreamType;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Built-in YouTube site for ynoTV Android: browse YouTube kiosks, keyword
 * channels and search through NewPipeExtractor. Playback hands the watch URL
 * to the app's existing YouTube extractor (player/extractor/YouTube.java).
 */
public class YouTubeSpider extends Spider {

    public static final String KEY = "ynotv_youtube";
    public static final String API = "builtin:youtube";

    private static final String[][] CLASSES = {
            {"kiosk:trending_music", "热门音乐"},
            {"kiosk:live", "正在直播"},
            {"kiosk:trending_gaming", "热门游戏"},
            {"kiosk:trending_movies_and_shows", "电影预告"},
            {"kiosk:trending_podcasts_episodes", "热门播客"},
            {"q:香港新闻", "香港新闻"},
            {"q:粤语歌", "粤语歌"},
            {"q:综艺", "综艺"},
            {"q:纪录片", "纪录片"},
            {"q:科技评测", "科技"},
    };

    private final Map<String, List<Page>> pages = new ConcurrentHashMap<>();
    private final Map<String, StreamInfoItem> items = new ConcurrentHashMap<>();

    public static Site site() {
        String json = "{\"key\":\"" + KEY + "\",\"name\":\"YouTube\",\"type\":3,\"api\":\"" + API + "\",\"searchable\":1,\"quickSearch\":1,\"changeable\":0}";
        return Site.objectFrom(JsonParser.parseString(json), "");
    }

    public static boolean isApi(String api) {
        return API.equals(api);
    }

    @Override
    public void init(Context context, String extend) {
        Locale locale = Locale.getDefault();
        String country = locale.getCountry();
        if (country == null || country.isEmpty()) country = "HK";
        NewPipe.init(NewPipeImpl.get(), Localization.fromLocale(locale), new ContentCountry(country));
    }

    @Override
    public String homeContent(boolean filter) throws Exception {
        JSONArray classes = new JSONArray();
        for (String[] c : CLASSES) classes.put(new JSONObject().put("type_id", c[0]).put("type_name", c[1]));
        return new JSONObject().put("class", classes).toString();
    }

    @Override
    public String homeVideoContent() throws Exception {
        try {
            return new JSONObject().put("list", fetch(CLASSES[0][0], 1).list).toString();
        } catch (Exception e) {
            return new JSONObject().put("list", new JSONArray()).toString();
        }
    }

    @Override
    public String categoryContent(String tid, String pg, boolean filter, HashMap<String, String> extend) throws Exception {
        return pageJson(tid, pg);
    }

    @Override
    public String searchContent(String key, boolean quick) throws Exception {
        return pageJson("q:" + key, "1");
    }

    @Override
    public String searchContent(String key, boolean quick, String pg) throws Exception {
        return pageJson("q:" + key, pg);
    }

    @Override
    public String detailContent(List<String> ids) throws Exception {
        String url = ids.get(0);
        JSONObject vod = new JSONObject().put("vod_id", url);
        StreamInfoItem item = items.get(url);
        if (item != null) {
            vod.put("vod_name", item.getName());
            vod.put("vod_pic", thumb(item.getThumbnails()));
            vod.put("vod_director", item.getUploaderName());
            vod.put("vod_remarks", remarks(item));
        } else {
            StreamInfo info = StreamInfo.getInfo(url);
            vod.put("vod_name", info.getName());
            vod.put("vod_pic", thumb(info.getThumbnails()));
            vod.put("vod_director", info.getUploaderName());
            if (info.getDescription() != null) vod.put("vod_content", info.getDescription().getContent());
        }
        vod.put("vod_play_from", "YouTube");
        vod.put("vod_play_url", "播放$" + url);
        return new JSONObject().put("list", new JSONArray().put(vod)).toString();
    }

    @Override
    public String playerContent(String flag, String id, List<String> vipFlags) throws Exception {
        return new JSONObject().put("parse", 0).put("url", id).toString();
    }

    private String pageJson(String tid, String pg) throws Exception {
        int page = 1;
        try { page = Math.max(1, Integer.parseInt(pg)); } catch (Exception ignored) { }
        Result r = fetch(tid, page);
        return new JSONObject()
                .put("page", page)
                .put("pagecount", r.hasNext ? page + 1 : page)
                .put("limit", r.list.length())
                .put("total", Integer.MAX_VALUE)
                .put("list", r.list).toString();
    }

    private record Result(JSONArray list, boolean hasNext) { }

    private ListExtractor<? extends InfoItem> extractor(String tid) throws Exception {
        if (tid.startsWith("kiosk:")) {
            return ServiceList.YouTube.getKioskList().getExtractorById(tid.substring(6), null);
        }
        String q = tid.startsWith("q:") ? tid.substring(2) : tid;
        return ServiceList.YouTube.getSearchExtractor(q, List.of(YoutubeSearchQueryHandlerFactory.VIDEOS), "");
    }

    private synchronized Result fetch(String tid, int page) throws Exception {
        ListExtractor<? extends InfoItem> ex = extractor(tid);
        ex.fetchPage();
        List<Page> known = pages.computeIfAbsent(tid, k -> new ArrayList<>());
        ListExtractor.InfoItemsPage<? extends InfoItem> data;
        if (page == 1) {
            known.clear();
            data = ex.getInitialPage();
        } else if (page - 2 < known.size() && known.get(page - 2) != null) {
            data = ex.getPage(known.get(page - 2));
        } else {
            return new Result(new JSONArray(), false);
        }
        while (known.size() < page) known.add(null);
        if (data.hasNextPage()) known.set(page - 1, data.getNextPage());
        JSONArray list = new JSONArray();
        for (InfoItem it : data.getItems()) {
            if (!(it instanceof StreamInfoItem s)) continue;
            items.put(s.getUrl(), s);
            list.put(new JSONObject()
                    .put("vod_id", s.getUrl())
                    .put("vod_name", s.getName())
                    .put("vod_pic", thumb(s.getThumbnails()))
                    .put("vod_remarks", remarks(s)));
        }
        return new Result(list, data.hasNextPage());
    }

    private static String remarks(StreamInfoItem s) {
        if (s.getStreamType() == StreamType.LIVE_STREAM || s.getDuration() < 0) return "直播";
        long d = s.getDuration();
        if (d == 0) return s.getUploaderName() == null ? "" : s.getUploaderName();
        return d >= 3600 ? String.format(Locale.US, "%d:%02d:%02d", d / 3600, d / 60 % 60, d % 60) : String.format(Locale.US, "%d:%02d", d / 60, d % 60);
    }

    private static String thumb(List<Image> images) {
        if (images == null || images.isEmpty()) return "";
        Image best = images.get(0);
        for (Image i : images) if (i.getHeight() > best.getHeight()) best = i;
        return best.getUrl();
    }
}
