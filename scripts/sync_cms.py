#!/usr/bin/env python3
"""
自動同步醫院部門網頁系統 → cms.json
--------------------------------------------------
讀取彰基部門網頁「計畫成果分享」「工作討論議錄」的文章列表，
整理成 cms.json，讓 GitHub 網頁自動顯示最新文章。

同時讀「數位學習與服務」「多元教學資源」與「課程活動訊息」的最新各季課程清單。
由 .github/workflows/sync-cms.yml 每天自動執行，不需要手動操作。
只用 Python 內建模組，不需要安裝任何套件。

醫院網頁改版時，通常只需要調整下方「設定」區。
"""
import html
import threading
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin

# ===================== 設定 =====================
BASE = os.environ.get('CMS_BASE', 'https://dpt.cch.org.tw/layout/layout_1/')
SITE_ID = '91192'
SECTIONS = {               # 輸出名稱: 醫院系統的分類 cID
    'results': '610',      # 計畫成果分享
    'minutes': '611',      # 工作討論議錄
    'digital': '609',      # 數位學習與服務
    'teaching': '612',     # 多元教學資源
}
ALLOW_EMPTY = {'digital', 'teaching'}   # 這些分類目前沒有文章也算正常
COURSE_CID = '1349'        # 最新消息 › 課程活動訊息（每季一篇課程清單）
COURSE_LISTS = 2           # 讀最新幾季的課程清單（2 = 最新一季＋上一季，避免換季時舊課消失）
GET_IMAGE = {'results'}    # 這些分類會進入文章抓第一張照片
MAX_PAGES = 20             # 每個分類最多讀幾頁列表
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'cms.json')
TIME_BUDGET = int(os.environ.get('SYNC_TIME_BUDGET', 8 * 60))       # 總執行時間上限（秒），超過就先存已抓到的，其餘下次再抓
IMAGE_SCAN_BYTES = 3_000_000  # 找照片時，每篇文章最多讀多少（位元組）
REQUEST_LIMIT = int(os.environ.get('SYNC_REQUEST_LIMIT', 45))        # 單一網頁最多等幾秒
KEEPALIVE_DAYS = 30        # 內容沒變時，每隔幾天仍更新一次時間戳，避免 GitHub 停用排程
# ================================================

TW = timezone(timedelta(hours=8))
START = time.monotonic()
try:  # 讓 GitHub 的執行紀錄即時顯示進度
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except AttributeError:
    pass


def over_budget():
    return time.monotonic() - START > TIME_BUDGET
UA = 'Mozilla/5.0 (compatible; CCH-Shengeng-Sync/1.0; +https://github.com)'


def _get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9'})
    with urllib.request.urlopen(req, timeout=20) as r:
        cs = r.headers.get_content_charset() or 'utf-8'
        chunks, t0 = [], time.monotonic()
        while True:
            b = r.read(65536)
            if not b:
                break
            chunks.append(b)
            if time.monotonic() - t0 > REQUEST_LIMIT:
                raise TimeoutError('下載太慢')
    raw = b''.join(chunks)
    try:
        return raw.decode(cs)
    except (LookupError, UnicodeDecodeError):
        return raw.decode('utf-8', errors='replace')


def fetch(url, tries=3):
    """讀取網頁；每次最多等 REQUEST_LIMIT 秒（連 DNS 卡住也算），失敗會重試。"""
    for i in range(tries):
        box = {}

        def work():
            try:
                box['ok'] = _get(url)
            except Exception as e:  # noqa: BLE001
                box['err'] = e
        t0 = time.monotonic()
        th = threading.Thread(target=work, daemon=True)
        th.start()
        th.join(REQUEST_LIMIT + 5)
        took = time.monotonic() - t0
        if 'ok' in box:
            print(f'    ✓ {took:.1f} 秒　{url}')
            return box['ok']
        err = box.get('err', f'超過 {REQUEST_LIMIT} 秒沒有回應')
        print(f'  ! 讀取失敗（第 {i + 1} 次，{took:.0f} 秒）{url}：{err}', file=sys.stderr)
        if over_budget():
            break
        time.sleep(3 * (i + 1))
    raise RuntimeError(f'無法讀取 {url}')


def text_parts(fragment):
    """把一段 HTML 拆成一段段純文字。"""
    fragment = re.sub(r'(?is)<(script|style)\b.*?</\1>', ' ', fragment)
    fragment = re.sub(r'(?i)<br\s*/?>|</(p|div|h\d|li|span|td|dt|dd)>', '\n', fragment)
    fragment = re.sub(r'<[^>]+>', ' ', fragment)
    fragment = html.unescape(fragment).replace('　', '　')
    parts = [re.sub(r'[ \t\r\f\v]+', ' ', p).strip() for p in fragment.split('\n')]
    return [p for p in parts if p]


DATE_RE = re.compile(r'(20\d{2})[./-](\d{1,2})[./-](\d{1,2})')


def parse_list(page_html, cid):
    """從列表頁找出所有文章：Key、標題、日期、摘要。"""
    items = {}
    pat = re.compile(r'(?is)<a\b[^>]*href\s*=\s*["\']([^"\']*item_detail\.aspx\?[^"\']*)["\'][^>]*>(.*?)</a>')
    for mm in pat.finditer(page_html):
        href, inner = mm.group(1), mm.group(2)
        href_u = html.unescape(href)
        if not re.search(r'[?&]cID=' + cid + r'(?:&|$)', href_u):
            continue
        m = re.search(r'[?&]Key=(\d+)', href_u)
        if not m:
            continue
        key = m.group(1)
        joined = ' '.join(text_parts(inner))
        d = DATE_RE.search(joined)
        title, summary, date = joined, '', ''
        if not d:  # 日期不在連結裡時，往後找一小段
            near = DATE_RE.search(' '.join(text_parts(page_html[mm.end():mm.end() + 400])))
            if near:
                date = f'{near.group(1)}/{int(near.group(2)):02d}/{int(near.group(3)):02d}'
        if d:
            date = f'{d.group(1)}/{int(d.group(2)):02d}/{int(d.group(3)):02d}'
            title = joined[:d.start()].strip()
            summary = joined[d.end():].strip()
        title = re.sub(r'\s+', ' ', title).strip(' -｜|')
        if not title:
            continue
        nt, ns = re.sub(r'[\s　]', '', title), re.sub(r'[\s　]', '', summary)
        if ns and (ns == nt or nt.startswith(ns) or ns.startswith(nt)):
            summary = ''
        if len(summary) > 90:
            summary = summary[:88].rstrip() + '…'
        url = urljoin(BASE, href_u)
        old = items.get(key)
        # 同一篇可能出現多個連結（圖示、標題），保留資訊最完整的那個
        if not old or (date and not old['日期']) or len(title) > len(old['標題']):
            items[key] = {'key': key, '日期': date, '標題': title, '摘要': summary, '文章連結': url}
    return items


IMG_RE = re.compile(r'(?i)(?:src|href)\s*=\s*["\']([^"\']*/upload/site_item/[^"\']+?\.(?:jpe?g|png|gif|webp))["\']')


def first_image(article_url):
    """只讀文章開頭，找到第一張照片就停；網頁太大（照片直接嵌在網頁裡）時，讀到上限就放棄。"""
    found, t0 = {}, time.monotonic()

    def work():
        try:
            req = urllib.request.Request(article_url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                buf = b''
                while len(buf) < IMAGE_SCAN_BYTES and time.monotonic() - t0 < REQUEST_LIMIT:
                    b = r.read(32768)
                    if not b:
                        break
                    tail = buf[-400:] + b   # 只搜尋新讀到的部分（留一點重疊，避免網址被切斷）
                    buf += b
                    m = IMG_RE.search(tail.decode('utf-8', errors='ignore'))
                    if m:
                        found['url'] = urljoin(article_url, html.unescape(m.group(1)))
                        return
        except Exception as e:  # noqa: BLE001
            found['err'] = e
    th = threading.Thread(target=work, daemon=True)
    th.start()
    th.join(REQUEST_LIMIT + 5)
    took = time.monotonic() - t0
    if 'err' in found:
        print(f'  ! 讀取文章失敗（{took:.0f} 秒）{article_url}：{found["err"]}', file=sys.stderr)
        raise RuntimeError(article_url)
    print(f'    ✓ {took:.1f} 秒　{article_url}')
    return found.get('url', '')


def crawl(section, cid, cache):
    found, order = {}, []
    for p in range(1, MAX_PAGES + 1):
        url = f'{BASE}item.aspx?cID={cid}&ID={SITE_ID}' + (f'&p={p}' if p > 1 else '')
        try:
            items = parse_list(fetch(url), cid)
        except RuntimeError as e:
            if p == 1:
                raise
            print(f'  ! 第 {p} 頁讀取失敗，先用已讀到的：{e}', file=sys.stderr)
            break
        new = [k for k in items if k not in found]
        print(f'  {section} 第 {p} 頁：{len(items)} 篇，新的 {len(new)} 篇')
        if not new:
            break
        for k in new:
            found[k] = items[k]
            order.append(k)
        time.sleep(1)

    out = []
    for k in order:
        it = found[k]
        old = cache.get(k, {})
        if section in GET_IMAGE:
            if old.get('_checked'):
                it['圖片連結'] = old.get('圖片連結', '')
            elif over_budget():
                it['圖片連結'] = old.get('圖片連結', '')  # 時間不夠，照片下次再抓
                out.append(it)
                continue
            else:
                try:
                    it['圖片連結'] = first_image(it['文章連結'])
                    print(f'    抓照片 Key={k}：{"有" if it["圖片連結"] else "無"}')
                except RuntimeError:
                    it['圖片連結'] = old.get('圖片連結', '')
                time.sleep(1)
            it['_checked'] = True
        if not it['日期'] and old.get('日期'):
            it['日期'] = old['日期']
        out.append(it)
    out.sort(key=lambda x: x.get('日期', ''), reverse=True)
    return out


# ===================== 課程清單 =====================
SEASON_NUM = {'一': 1, 'ㄧ': 1, '1': 1, '二': 2, '2': 2, '三': 3, '3': 3, '四': 4, '4': 4}


def parse_news_list(page_html):
    """課程活動訊息列表：找出各季課程清單（標題含「X年第X季」）。"""
    out, seen = [], set()
    pat = re.compile(r'(?is)<a\b[^>]*href\s*=\s*["\']([^"\']*news_detail\.aspx\?[^"\']*)["\'][^>]*>(.*?)</a>')
    for m in pat.finditer(page_html):
        href = html.unescape(m.group(1))
        if not re.search(r'[?&]cID=' + COURSE_CID + r'(?:&|$)', href):
            continue
        k = re.search(r'[?&]Key=(\d+)', href)
        txt = ' '.join(text_parts(m.group(2)))
        sm = re.search(r'(\d{2,3})\s*年\s*第\s*([一ㄧ二三四1-4])\s*季', txt)
        if not k or not sm or k.group(1) in seen:
            continue
        seen.add(k.group(1))
        out.append({'key': k.group(1), 'season': f'{sm.group(1)}-Q{SEASON_NUM[sm.group(2)]}',
                    'order': (int(sm.group(1)), SEASON_NUM[sm.group(2)]), 'url': urljoin(BASE, href)})
    out.sort(key=lambda x: x['order'], reverse=True)
    return out


def roc_date(y, mo, d):
    y = int(y)
    if y < 1911:
        y += 1911
    return f'{y}/{int(mo):02d}/{int(d):02d}'


def cell_links(cell):
    links = []
    for m in re.finditer(r'(?is)<a\b[^>]*href\s*=\s*["\']([^"\']+)["\'][^>]*>(.*?)</a>', cell):
        href = html.unescape(m.group(1)).strip()
        if href.startswith('#') or href.lower().startswith('javascript'):
            continue
        links.append((' '.join(text_parts(m.group(2))), urljoin(BASE, href)))
    return links


def parse_course_table(page_html, season):
    """讀課程清單的表格：日期及時間｜課程名稱｜課程地點｜附件｜報名｜備註。"""
    rows = re.findall(r'(?is)<tr\b[^>]*>(.*?)</tr>', page_html)
    col, courses = None, []
    for row in rows:
        cells = re.findall(r'(?is)<t[dh]\b[^>]*>(.*?)</t[dh]>', row)
        texts = [' '.join(text_parts(c)) for c in cells]
        if col is None:
            joined = ''.join(texts)
            if '日期' in joined and ('課程' in joined or '名稱' in joined):
                col = {}
                for i, t in enumerate(texts):
                    if '日期' in t or '時間' in t:
                        col.setdefault('date', i)
                    elif '地點' in t or '地址' in t:
                        col.setdefault('place', i)
                    elif '名稱' in t or '課程' in t or '主題' in t:
                        col.setdefault('title', i)
                    elif '附件' in t or '海報' in t:
                        col.setdefault('attach', i)
                    elif '報名' in t:
                        col.setdefault('reg', i)
                    elif '備註' in t or '說明' in t:
                        col.setdefault('note', i)
            continue
        if 'date' not in col or 'title' not in col or len(cells) <= max(col['date'], col['title']):
            continue
        g = lambda k: cells[col[k]] if k in col and col[k] < len(cells) else ''
        dt = ' '.join(text_parts(g('date')))
        dm = re.search(r'(\d{2,4})\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})', dt)
        if not dm:
            continue
        tm = re.search(r'(\d{1,2}:\d{2})\s*[~～\-–－至到]\s*(\d{1,2}:\d{2})', dt)
        # 課程名稱可能分兩行：「與時俱進課程─」＋「解構…」
        tl = text_parts(g('title'))
        title = ''
        for part in tl:
            if not title:
                title = part
            elif re.search(r'[-－─—–:：]$', title):
                title += part
            else:
                title += '－' + part
        if not title:
            continue
        place = '／'.join(text_parts(g('place')))
        note = ' '.join(text_parts(g('note')))
        reg_text = ' '.join(text_parts(g('reg')))
        poster = brochure = ''
        for txt, u in cell_links(g('attach')):
            low = u.lower()
            if not poster and ('海報' in txt or re.search(r'\.(png|jpe?g|gif|webp)$', low)):
                poster = u
            elif not brochure:
                brochure = u
        reg_links = cell_links(g('reg'))
        reg_url = reg_links[0][1] if reg_links else ''
        how = '線上表單' if reg_url else (reg_text or '')
        if re.search(r'洽.*窗口|窗口', how):
            how = '洽合作醫院窗口'
        deadline = ''
        dl = re.search(r'截止[日期]*[:：]?\s*(\d{2,4})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{1,2})', note + ' ' + reg_text)
        if dl:
            deadline = roc_date(*dl.groups())
        else:  # 「10/22前報名」這種沒寫年份的，用上課日期的年份推算
            dl2 = re.search(r'(?<![\d/])(\d{1,2})\s*/\s*(\d{1,2})\s*(?:\([^)]*\)|（[^）]*）)?\s*(?:前|截止)', note + ' ' + reg_text)
            if dl2:
                cy, cm = int(roc_date(*dm.groups())[:4]), int(dm.group(2))
                mo = int(dl2.group(1))
                deadline = roc_date(cy - 1 if mo > cm else cy, mo, dl2.group(2))
        courses.append({
            '季別': season, '日期': roc_date(*dm.groups()),
            '開始': tm.group(1) if tm else '', '結束': tm.group(2) if tm else '',
            '課程名稱': title, '地點': place, '報名方式': how, '報名連結': reg_url,
            '報名截止': deadline, '海報連結': poster, '簡章連結': brochure, '備註': note,
        })
    return courses, col is not None


def crawl_courses():
    lists = parse_news_list(fetch(f'{BASE}news.aspx?cID={COURSE_CID}&ID={SITE_ID}'))
    print(f'  找到 {len(lists)} 季課程清單：' + '、'.join(x['season'] for x in lists))
    out = []
    for it in lists[:COURSE_LISTS]:
        rows, ok = parse_course_table(fetch(it['url']), it['season'])
        print(f'  {it["season"]}：{len(rows)} 堂課' + ('' if ok else '（找不到課程表格）'))
        for r in rows:
            r['來源連結'] = it['url']
        out += rows
        time.sleep(1)
    out.sort(key=lambda r: r['日期'], reverse=True)
    return out, bool(lists)


def main():
    print(f'開始同步：{BASE}（單頁上限 {REQUEST_LIMIT} 秒，總時間上限 {TIME_BUDGET // 60} 分鐘）')
    try:
        with open(OUT, encoding='utf-8') as f:
            prev = json.load(f)
    except (OSError, ValueError):
        prev = {}

    data = {}
    for section, cid in SECTIONS.items():
        print(f'讀取 {section}（cID={cid}）')
        cache = {x.get('key'): x for x in prev.get(section, []) if x.get('key')}
        try:
            rows = crawl(section, cid, cache)
        except RuntimeError as e:
            print(f'✗ 連不到醫院網頁：{e}\n  可能是醫院網站擋了 GitHub 的海外主機，或網站暫時沒有回應。網站會繼續顯示上次的資料。', file=sys.stderr)
            sys.exit(1)
        if not rows and section in ALLOW_EMPTY:
            print(f'  {section} 目前沒有文章')
        elif not rows:
            # 一篇都抓不到 → 多半是醫院網頁改版或暫時連不上，保留舊資料並回報失敗
            print(f'✗ {section} 一篇文章都沒抓到，保留舊資料。請檢查醫院網頁是否改版。', file=sys.stderr)
            sys.exit(1)
        data[section] = rows

    print(f'讀取課程清單（cID={COURSE_CID}）')
    try:
        courses, found = crawl_courses()
        if not found:
            print('  ! 找不到任何一季的課程清單，保留上次的課程資料', file=sys.stderr)
            courses = prev.get('courses', [])
    except RuntimeError as e:
        print(f'  ! 課程清單讀取失敗，保留上次的課程資料：{e}', file=sys.stderr)
        courses = prev.get('courses', [])
    data['courses'] = courses

    now = datetime.now(TW)
    same = all(prev.get(s) == data[s] for s in data)
    last = prev.get('updated', '')
    stale = True
    try:
        stale = now - datetime.fromisoformat(last) > timedelta(days=KEEPALIVE_DAYS)
    except ValueError:
        pass
    if same and not stale:
        print('內容沒有變化，不更新檔案。')
        return
    data = {'updated': now.isoformat(timespec='seconds'),
            'source': f'{BASE}index.aspx?ID={SITE_ID}', **data}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'✓ 已更新 cms.json：成果 {len(data["results"])} 篇、議錄 {len(data["minutes"])} 篇、'
          f'數位學習 {len(data["digital"])} 篇、多元教學資源 {len(data["teaching"])} 篇、課程 {len(data["courses"])} 堂')


if __name__ == '__main__':
    main()
