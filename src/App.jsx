import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Activity, ArrowDownUp, ArrowLeft, ArrowRight, Bell, Bookmark, Check,
  ChevronDown, ChevronRight, CircleHelp, Clock3, ExternalLink, Eye, FileText,
  Filter, Flame, Grid2X2, Heart, Home, ImagePlus, LayoutDashboard, LoaderCircle,
  LogIn, Menu, MessageCircle, Plus, RefreshCw, Search, Send, ShieldCheck,
  SlidersHorizontal, Sparkles, Star, ThumbsUp, Trash2, Trophy, Users, X
} from 'lucide-react';

const CFG = window.CFG || {};
const supabase = CFG.url && CFG.anon ? createClient(CFG.url, CFG.anon, {
  auth: { persistSession: false, autoRefreshToken: false }
}) : null;
const tg = window.Telegram?.WebApp;
const API_URL = `${String(CFG.url || '').replace(/\/$/, '')}/functions/v1/api`;
const STAFF = ['master_admin', 'admin', 'moderator', 'analyst'];
const STATUS = {
  pending: ['На модерации', 'pending'], approved: ['Опубликовано', 'approved'],
  rejected: ['Отклонено', 'rejected'], changes: ['Нужны исправления', 'changes'],
  hidden: ['Скрыто', 'hidden'], blocked: ['Заблокировано', 'blocked'], draft: ['Черновик', 'draft']
};

function fmt(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat('ru-RU', { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
}
function telegramLink(username) { return `https://t.me/${String(username || '').replace(/^@/, '')}`; }
function parseTelegramLink(raw) {
  const value = String(raw || '').trim();
  const match = value.match(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]{4,32})\/?$/i);
  const username = value.startsWith('@') ? value.slice(1) : match?.[1];
  if (!username || !/^[a-zA-Z0-9_]{4,32}$/.test(username)) return null;
  return username.toLowerCase();
}

export default function App() {
  const [tab, setTab] = useState('home');
  const [categories, setCategories] = useState([]);
  const [communities, setCommunities] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardMetric, setLeaderboardMetric] = useState('votes');
  const [leaderboardPeriod, setLeaderboardPeriod] = useState('all');
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [promotionCommunityId, setPromotionCommunityId] = useState('');
  const [promotionDuration, setPromotionDuration] = useState('3');
  const [media, setMedia] = useState({});
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loaderMinimumDone, setLoaderMinimumDone] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setLoaderMinimumDone(true), 6000);
    return () => window.clearTimeout(timer);
  }, []);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState('top');
  const [details, setDetails] = useState(null);
  const [profilePage, setProfilePage] = useState('main');
  const [add, setAdd] = useState({ title: '', link: '', description: '', category: '', kind: 'channel', tags: '' });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [queue, setQueue] = useState([]);
  const [selectedQueueItem, setSelectedQueueItem] = useState(null);
  const [stats, setStats] = useState(null);
  const [adminItems, setAdminItems] = useState([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [showAllHomeCategories, setShowAllHomeCategories] = useState(false);
  const [homeSort, setHomeSort] = useState('votes');

  const initData = tg?.initData || '';
  const telegramUser = tg?.initDataUnsafe?.user || null;
  const isStaff = STAFF.includes(me?.role);
  const canModerate = ['master_admin', 'admin', 'moderator'].includes(me?.role);
  const canManage = ['master_admin', 'admin', 'moderator'].includes(me?.role);
  const votedIds = useMemo(() => new Set((me?.voted || []).map(Number)), [me]);
  const favoriteIds = useMemo(() => new Set((me?.favs || []).map(Number)), [me]);
  const unreadNotes = me?.notes || [];

  const notify = useCallback((message) => {
    setToast(message);
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToast(''), 2600);
  }, []);

  const api = useCallback(async (action, payload = {}) => {
    if (!initData) throw new Error('Открой Bendor-X через Telegram, чтобы войти в аккаунт.');
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: CFG.anon,
        Authorization: `Bearer ${CFG.anon}`
      },
      body: JSON.stringify({ action, initData, ...payload })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || result.message || `Ошибка сервера (${response.status})`);
    return result.data;
  }, [initData]);

  const loadPublic = useCallback(async (opts = {}) => {
    if (!supabase) throw new Error('Не найдена конфигурация Supabase. Проверь config.js.');
    const q = opts.query ?? query;
    const cat = opts.category ?? category;
    const order = opts.sort ?? sort;
    const [catResult, listResult, mediaResult] = await Promise.all([
      supabase.rpc('tx_categories'),
      supabase.rpc('tx_catalog', { p_q: q.trim() || null, p_cat: cat === 'all' ? null : Number(cat), p_sort: order, p_limit: 1000 }),
      supabase.rpc('tx_media')
    ]);
    if (catResult.error) throw catResult.error;
    if (listResult.error) throw listResult.error;
    setCategories(catResult.data || []);
    setCommunities(listResult.data || []);
    const map = {};
    (mediaResult.data || []).forEach((item) => { map[item.id] = item.avatar_path; });
    setMedia(map);
  }, [query, category, sort]);

  const openHome = () => {
    setTab('home');
    setQuery('');
    setCategory('all');
    setCategoryQuery('');
    setSort('top');
    loadPublic({ query: '', category: 'all', sort: 'top' });
  };

  const openCategories = () => {
    setTab('catalog');
    setQuery('');
    setCategory('all');
    setCategoryQuery('');
    setSort('top');
    loadPublic({ query: '', category: 'all', sort: 'top' });
  };

  const loadLeaderboard = useCallback(async (opts = {}) => {
    if (!supabase) throw new Error('Не найдена конфигурация Supabase. Проверь config.js.');
    const metric = opts.metric || leaderboardMetric;
    const period = opts.period || leaderboardPeriod;
    setLeaderboardLoading(true);
    try {
      const { data, error: leaderboardError } = await supabase.rpc('tx_leaderboard', {
        p_metric: metric,
        p_period: period,
        p_limit: 10
      });
      if (leaderboardError) throw leaderboardError;
      setLeaderboard(data || []);
    } finally {
      setLeaderboardLoading(false);
    }
  }, [leaderboardMetric, leaderboardPeriod]);

  const loadMe = useCallback(async () => {
    if (!initData) { setMe(null); return; }
    const data = await api('me');
    setMe(data || null);
  }, [api, initData]);

  const loadAdmin = useCallback(async () => {
    if (!initData || !STAFF.includes(me?.role)) return;
    const [q, s] = await Promise.all([api('queue'), api('stats')]);
    const all = canManage ? await api('admin_list', { deleted: showDeleted }) : [];
    setQueue(q || []); setStats(s || null); setAdminItems(all || []);
  }, [api, initData, me?.role, showDeleted, canManage]);

  const refresh = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      await loadPublic();
      if (initData) await loadMe();
    } catch (err) {
      setError(err.message || 'Не удалось загрузить данные');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [loadPublic, loadMe, initData]);

  useEffect(() => {
    try { tg?.ready?.(); tg?.expand?.(); tg?.setHeaderColor?.('#111318'); tg?.setBackgroundColor?.('#111318'); } catch {}
    refresh();
  }, []);

  useEffect(() => {
    if (me && isStaff) loadAdmin().catch((err) => notify(err.message));
  }, [me?.role, showDeleted]);

  useEffect(() => {
    if (tab === 'rating') loadLeaderboard().catch((err) => notify(err.message));
  }, [tab, loadLeaderboard, notify]);

  const reloadEverything = async () => {
    await loadPublic();
    if (initData) await loadMe();
    if (isStaff) await loadAdmin();
  };

  const changeVote = async (id) => {
    try {
      if (!initData) return notify('Войди через Telegram, чтобы голосовать.');
      if (votedIds.has(Number(id))) await api('unvote', { id });
      else await api('vote', { id });
      await reloadEverything();
      notify(votedIds.has(Number(id)) ? 'Голос отменён' : 'Голос учтён');
    } catch (err) { notify(err.message); }
  };

  const changeFavorite = async (id) => {
    try {
      await api('fav', { id });
      await loadMe();
      notify(favoriteIds.has(Number(id)) ? 'Удалено из избранного' : 'Добавлено в избранное');
    } catch (err) { notify(err.message); }
  };

  const openCommunity = (item) => {
    setDetails(item);
  };

  const openTelegram = (username) => {
    const link = telegramLink(username);
    if (tg?.openTelegramLink) tg.openTelegramLink(link);
    else window.open(link, '_blank', 'noopener,noreferrer');
  };

  const openCommunityTelegram = async (item) => {
    if (!item?.username) return notify('У сообщества нет публичной ссылки Telegram.');
    try { if (initData) await api('click', { id: item.id }); } catch {}
    openTelegram(item.username);
  };

  const openTelegramUser = (username, userId) => {
    if (username) {
      openTelegram(username);
      return;
    }
    if (userId) {
      window.location.href = `tg://user?id=${encodeURIComponent(String(userId))}`;
      return;
    }
    notify('У отправителя нет доступной ссылки на Telegram-профиль.');
  };

  const uploadAvatar = async () => {
    if (!imageFile) return '';
    if (!supabase) throw new Error('Supabase не настроен');
    if (imageFile.size > 8 * 1024 * 1024) throw new Error('Изображение должно быть меньше 8 МБ');
    const normalized = await new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(imageFile);
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Не удалось обработать изображение')), 'image/jpeg', 0.86);
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать изображение')); };
      image.src = url;
    });
    const signed = await api('upload_url');
    const { error: uploadError } = await supabase.storage.from('community-media').uploadToSignedUrl(
      signed.path, signed.token, normalized, { contentType: 'image/jpeg' }
    );
    if (uploadError) throw new Error(`Не удалось загрузить изображение: ${uploadError.message}`);
    return signed.path;
  };

  const submitCommunity = async (event) => {
    event.preventDefault();
    const username = parseTelegramLink(add.link);
    if (!username) return notify('Укажи корректную публичную ссылку t.me или @username.');
    if (add.title.trim().length < 2) return notify('Название должно содержать минимум 2 символа.');
    if (!add.category) return notify('Выбери категорию.');
    if (add.description.trim().length > 500) return notify('Описание слишком длинное.');
    setSubmitting(true);
    try {
      const avatar = await uploadAvatar();
      await api('submit', {
        username, title: add.title.trim(), description: add.description.trim(),
        category: Number(add.category), kind: add.kind,
        tags: add.tags.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 5).join(','), avatar
      });
      setAdd({ title: '', link: '', description: '', category: '', kind: 'channel', tags: '' });
      setImageFile(null); setImagePreview('');
      await reloadEverything(); setTab('profile'); setProfilePage('publications');
      notify('Заявка отправлена на модерацию');
    } catch (err) { notify(err.message); }
    finally { setSubmitting(false); }
  };

  const moderate = async (item, status, reason = '') => {
    try {
      await api('moderate', { id: item.id, status, reason });
      setRejecting(null); setRejectReason(''); setSelectedQueueItem(null);
      await reloadEverything();
      notify(status === 'approved' ? 'Сообщество опубликовано' : 'Статус обновлён');
    } catch (err) { notify(err.message); }
  };

  const adminDelete = async (item) => {
    if (!window.confirm(`Удалить «${item.title}»? Запись можно будет восстановить.`)) return;
    try { await api('admin_delete', { id: item.id }); await reloadEverything(); notify('Сообщество удалено'); }
    catch (err) { notify(err.message); }
  };
  const adminRestore = async (item) => {
    try { await api('admin_restore', { id: item.id }); await reloadEverything(); notify('Сообщество восстановлено'); }
    catch (err) { notify(err.message); }
  };

  const homeCommunities = useMemo(() => [...communities].sort((a, b) => homeSort === 'alphabet' ? String(a.title || '').localeCompare(String(b.title || ''), 'ru', { sensitivity: 'base' }) : Number(b.votes || 0) - Number(a.votes || 0)), [communities, homeSort]);

  const filtered = communities;
  const filteredCategories = useMemo(() => {
    const needle = categoryQuery.trim().toLocaleLowerCase('ru-RU');
    return categories.filter((item) => !needle || String(item.title || '').toLocaleLowerCase('ru-RU').includes(needle));
  }, [categories, categoryQuery]);
  const favCommunities = useMemo(() => communities.filter((x) => favoriteIds.has(Number(x.id))), [communities, favoriteIds]);
  const votedCommunities = useMemo(() => communities.filter((x) => votedIds.has(Number(x.id))), [communities, votedIds]);
  const myCommunities = me?.communities || [];
  const categoryLabel = (id) => categories.find((x) => Number(x.id) === Number(id))?.title || 'Без категории';
  const avatarUrl = (item) => media[item.id] ? `${CFG.url}/storage/v1/object/public/community-media/${media[item.id]}` : '';

  const CommunityCard = ({ item, compact = false, badge = '' }) => (
    <article className={`community-card ${compact ? 'compact' : ''}`}>
      <button className="community-main" onClick={() => openCommunity(item)}>
        {avatarUrl(item) ? <img className="avatar" src={avatarUrl(item)} alt="" /> : <div className="avatar fallback">{(item.title || '?').slice(0, 1).toUpperCase()}</div>}
        <span className="community-copy">
          <strong>{item.title}</strong>
          {badge && <span className="community-card-badge">{badge}</span>}
          <small>{item.username ? `@${item.username}` : ''} <i>·</i> {item.category || categoryLabel(item.category_id)}</small>
          {!compact && <span className="community-description">{item.description || 'Описание пока не добавлено.'}</span>}
          <span className="community-meta"><span><ThumbsUp size={13}/>{fmt(item.votes)}</span><span><Flame size={13}/>{fmt(item.growth)} за 7 дней</span></span>
        </span>
      </button>
      <div className="community-actions">
        <button className={`icon-button ${favoriteIds.has(Number(item.id)) ? 'selected' : ''}`} title="Избранное" onClick={() => changeFavorite(item.id)}><Bookmark size={17}/></button>
        <button className={`vote-button ${votedIds.has(Number(item.id)) ? 'voted' : ''}`} onClick={() => changeVote(item.id)}>
          {votedIds.has(Number(item.id)) ? <Check size={15}/> : <ThumbsUp size={15}/>} {votedIds.has(Number(item.id)) ? 'Отдан' : 'Голос'}
        </button>
      </div>
    </article>
  );

  const PageHeader = ({ eyebrow, title, subtitle, action }) => (
    <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</div>
  );

  const nav = [
    ['home', Home, 'Главная'], ['catalog', Grid2X2, 'Категории'], ['add', Plus, 'Добавить'], ['rating', Trophy, 'Рейтинг'], ['profile', Users, 'Профиль']
  ];

  const renderHome = () => (
    <>
      <section className="promo-banner">
        <div className="promo-banner-content">
          <span className="eyebrow"><Star size={13}/> РЕКЛАМНОЕ РАЗМЕЩЕНИЕ</span>
          <h1>Продвинь свой канал<br/><em>в Bendor-X</em></h1>
          <p>Покажи своё сообщество пользователям платформы. Выбери канал и срок продвижения за Telegram Stars.</p>
          <button className="primary-button promo-banner-button" onClick={()=>setPromotionOpen(true)}>Продвинуть за <Star size={15} fill="currentColor"/> Stars</button>
        </div>
        <div className="promo-banner-art"><div className="promo-star-orbit"/><Star size={76} fill="currentColor"/></div>
      </section>
      <div className="section-head home-section-heading">
        <div><div className="eyebrow">ВСЕ ОПУБЛИКОВАННЫЕ СООБЩЕСТВА</div><h2>Все каналы</h2><p className="home-section-note">{homeSort === 'votes' ? 'Сначала сообщества с наибольшим количеством голосов.' : 'Каналы отсортированы по алфавиту.'}</p></div>
        <button type="button" className="home-sort-label home-sort-button" onClick={() => setHomeSort(current => current === 'votes' ? 'alphabet' : 'votes')} aria-label={homeSort === 'votes' ? 'Переключить сортировку на алфавит' : 'Переключить сортировку на количество голосов'}><ArrowDownUp size={13}/> {homeSort === 'votes' ? 'По голосам' : 'По алфавиту'}</button>
      </div>
      {homeCommunities.length
        ? <div className="community-list">{homeCommunities.map(item=><CommunityCard key={item.id} item={item}/>)}</div>
        : <EmptyState text="Пока нет одобренных сообществ. После модерации каналы появятся здесь."/>}
    </>
  );

  const renderCatalog = () => (
    <>
      <PageHeader eyebrow="ПОИСК ПО ТЕМАМ И СООБЩЕСТВАМ" title="Категории" subtitle="Найди нужную тему или сразу ищи конкретный канал." action={<button className="icon-button" onClick={()=>refresh(true)}><RefreshCw size={17}/></button>}/>
      <div className="search-box category-search-box">
        <Search size={18}/>
        <input value={categoryQuery} onChange={(e)=>setCategoryQuery(e.target.value)} placeholder="Поиск категории..."/>
        {categoryQuery && <button onClick={()=>setCategoryQuery('')} aria-label="Очистить поиск категорий"><X size={16}/></button>}
      </div>
      <div className="category-grid categories-page-grid">
        <button className={`category-tile ${category==='all'?'category-tile-active':''}`} onClick={()=>{setCategory('all');loadPublic({query,category:'all',sort:'top'});}}>
          <span className="category-symbol"><Grid2X2 size={17}/></span>
          <span><b>Все категории</b><small>{fmt(categories.reduce((sum,item)=>sum+Number(item.groups||0),0))} сообществ</small></span><ChevronRight size={16}/>
        </button>
        {filteredCategories.map((item,index)=>(
          <button className={`category-tile ${category===String(item.id)?'category-tile-active':''}`} key={item.id} onClick={()=>{setCategory(String(item.id));loadPublic({query,category:String(item.id),sort:'top'});}}>
            <span className={`category-symbol tone-${index%6}`}>{item.icon || '✦'}</span>
            <span><b>{item.title}</b><small>{fmt(item.groups)} сообществ</small></span><ChevronRight size={16}/>
          </button>
        ))}
      </div>
      {!filteredCategories.length && <EmptyState text="Категории по такому запросу не найдены."/>}
      <div className="section-head categories-community-heading">
        <div><div className="eyebrow">ПОИСК И ОБЗОР</div><h2>{category==='all'?'Все сообщества':categoryLabel(category)}</h2></div>
        {category!=='all' && <button className="text-action" onClick={()=>{setCategory('all');loadPublic({query,category:'all',sort:'top'});}}>Сбросить категорию <X size={14}/></button>}
      </div>
      <div className="search-box">
        <Search size={18}/>
        <input value={query} onChange={(e)=>setQuery(e.target.value)} onKeyDown={(e)=>e.key==='Enter'&&loadPublic({query:e.target.value,category,sort:'top'})} placeholder="Поиск сообществ, каналов и @username"/>
        <button onClick={()=>loadPublic({query,category,sort:'top'})}><ArrowRight size={17}/></button>
      </div>
      {filtered.length ? <div className="community-list categories-community-list">{filtered.map(item=><CommunityCard key={item.id} item={item}/>)}</div> : <EmptyState text="Сообщества не найдены. Попробуй другую категорию или поисковый запрос."/>}
    </>
  );

  const renderAdd = () => (
    <>
      <PageHeader eyebrow="РАСШИРЯЙ АУДИТОРИЮ" title="Добавить сообщество" subtitle="Отправь заявку. После проверки модератором публикация появится в каталоге."/>
      {!initData ? <TelegramGate/> : <form className="form-panel" onSubmit={submitCommunity}>
        <div className="form-section-title"><span>01</span><div><b>Основная информация</b><small>Расскажи о своём сообществе</small></div></div>
        <label>Тип сообщества</label><div className="choice-row"><button type="button" className={add.kind === 'channel' ? 'chosen' : ''} onClick={() => setAdd({...add,kind:'channel'})}>Канал</button><button type="button" className={add.kind === 'group' ? 'chosen' : ''} onClick={() => setAdd({...add,kind:'group'})}>Группа / чат</button></div>
        <label>Ссылка Telegram</label><input required value={add.link} onChange={(e) => setAdd({...add,link:e.target.value})} placeholder="https://t.me/your_channel или @username"/>
        <label>Название</label><input required minLength={2} maxLength={80} value={add.title} onChange={(e) => setAdd({...add,title:e.target.value})} placeholder="Название канала или группы"/>
        <label>Категория</label><select required value={add.category} onChange={(e) => setAdd({...add,category:e.target.value})}><option value="">Выбери категорию</option>{categories.map((c)=><option key={c.id} value={c.id}>{c.title}</option>)}</select>
        <label>Описание <small>до 500 символов</small></label><textarea rows={4} maxLength={500} value={add.description} onChange={(e) => setAdd({...add,description:e.target.value})} placeholder="Чем полезно ваше сообщество?"/>
        <label>Теги <small>через запятую, максимум 5</small></label><input value={add.tags} onChange={(e) => setAdd({...add,tags:e.target.value})} placeholder="Новости, технологии, обучение"/>
        <div className="upload-box"><div className="upload-preview">{imagePreview ? <img src={imagePreview} alt="Предпросмотр"/> : <ImagePlus size={24}/>}</div><div><b>Аватар сообщества</b><small>Необязательно · JPG, PNG или WebP · до 8 МБ</small><label className="upload-link">Выбрать изображение<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e)=>{const f=e.target.files?.[0];if(!f)return;setImageFile(f);setImagePreview(URL.createObjectURL(f));}}/></label></div></div>
        <button className="primary-button full" disabled={submitting}>{submitting ? <LoaderCircle className="spin" size={17}/> : <Send size={16}/>} Отправить на модерацию</button>
      </form>}
    </>
  );

  const renderRating = () => (
    <>
      <PageHeader eyebrow="ТАБЛИЦА ЛИДЕРОВ" title="Рейтинг сообществ" subtitle="Десять лучших по голосам или реальным переходам в Telegram."/>
      <div className="leaderboard-metric-tabs">
        <button className={leaderboardMetric==='votes'?'active':''} onClick={()=>setLeaderboardMetric('votes')}><ThumbsUp size={16}/> По голосам</button>
        <button className={leaderboardMetric==='clicks'?'active':''} onClick={()=>setLeaderboardMetric('clicks')}><ExternalLink size={16}/> По переходам</button>
      </div>
      <div className="leaderboard-period-tabs">
        <button className={leaderboardPeriod==='all'?'active':''} onClick={()=>setLeaderboardPeriod('all')}>За всё время</button>
        <button className={leaderboardPeriod==='7d'?'active':''} onClick={()=>setLeaderboardPeriod('7d')}>7 дней</button>
        <button className={leaderboardPeriod==='30d'?'active':''} onClick={()=>setLeaderboardPeriod('30d')}>30 дней</button>
      </div>
      <div className="leaderboard-caption">{leaderboardMetric==='votes'?'Места определяются количеством действительных голосов.':'Учитываются нажатия на кнопку перехода в Telegram.'}</div>
      {leaderboardLoading
        ? <div className="loading-state"><LoaderCircle className="spin" size={24}/> Загружаем таблицу лидеров...</div>
        : leaderboard.length ? <div className="leaderboard-table-wrap">
          <table className="leaderboard-table">
            <thead><tr><th>Место</th><th>Сообщество</th><th>{leaderboardMetric==='votes'?'Голоса':'Переходы'}</th></tr></thead>
            <tbody>{leaderboard.slice(0,10).map((item,index)=>(
              <tr key={item.id}>
                <td><span className={`leaderboard-place place-${index+1}`}>{index+1}</span></td>
                <td><button className="leaderboard-channel" onClick={()=>openCommunity(item)}>
                  {avatarUrl(item)?<img src={avatarUrl(item)} alt=""/>:<span className="avatar fallback">{(item.title||'?').slice(0,1).toUpperCase()}</span>}
                  <span><b>{item.title}</b><small>@{item.username||'telegram'} · {item.category||categoryLabel(item.category_id)}</small></span>
                </button></td>
                <td><strong className="leaderboard-score">{fmt(item.metric_value)}</strong></td>
              </tr>
            ))}</tbody>
          </table>
        </div> : <EmptyState text={leaderboardMetric==='votes'?'За выбранный период голосов пока нет.':'За выбранный период переходов пока нет.'}/>}
    </>
  );

  const renderProfile = () => (
    <>
      <PageHeader eyebrow="ЛИЧНЫЙ КАБИНЕТ" title="Профиль" subtitle="Твои публикации, голоса и сохранённые сообщества."/>
      {!initData ? <TelegramGate/> : <>
        <div className="profile-card"><div className="profile-avatar">{telegramUser?.photo_url ? <img src={telegramUser.photo_url} alt=""/> : (telegramUser?.first_name || 'T').slice(0,1).toUpperCase()}</div><div className="profile-info"><b>{[telegramUser?.first_name,telegramUser?.last_name].filter(Boolean).join(' ') || 'Пользователь Telegram'}</b><span>@{telegramUser?.username || 'telegram_user'}</span><small className="role-pill">{me?.role || 'user'}</small></div><ShieldCheck className="profile-shield" size={21}/></div>
        <div className="metric-grid"><Metric icon={ThumbsUp} value={me?.voted?.length || 0} label="Голосов"/><Metric icon={Bookmark} value={me?.favs?.length || 0} label="Избранное"/><Metric icon={FileText} value={myCommunities.length} label="Публикации"/></div>
        <div className="profile-menu">
          <button onClick={()=>setProfilePage('publications')}><FileText/><span><b>Мои публикации</b><small>Статус заявок и статистика</small></span><ChevronRight/></button>
          <button onClick={()=>setProfilePage('votes')}><ThumbsUp/><span><b>Мои голосования</b><small>Сообщества, за которые ты голосовал</small></span><ChevronRight/></button>
          <button onClick={()=>setProfilePage('favorites')}><Bookmark/><span><b>Избранное</b><small>Сохранённые сообщества</small></span><ChevronRight/></button>
          <button onClick={()=>setTab('notifications')}><Bell/><span><b>Уведомления</b><small>Отдельная страница уведомлений</small></span><ChevronRight/></button>
          {isStaff && <button onClick={()=>{setTab('admin');loadAdmin().catch(e=>notify(e.message));}}><LayoutDashboard/><span><b>Панель управления</b><small>Отдельная страница модерации</small></span><ChevronRight/></button>}
        </div>
        {profilePage !== 'main' && <div className="subpage-panel"><div className="subpage-heading"><button className="icon-button" onClick={()=>setProfilePage('main')}><ArrowLeft size={17}/></button><h2>{profilePage==='publications'?'Мои публикации':profilePage==='votes'?'Мои голосования':'Избранное'}</h2></div>
          {profilePage==='publications' && <div className="my-pubs">{myCommunities.length ? myCommunities.map((item)=><div className="my-pub" key={item.id}><div><b>{item.title}</b><small>@{item.username} · {fmt(item.votes)} голосов</small></div><span className={`status status-${item.status}`}>{STATUS[item.status]?.[0] || item.status}</span></div>) : <EmptyState text="У тебя пока нет публикаций."/>}</div>}
          {profilePage==='votes' && <div className="community-list">{votedCommunities.length ? votedCommunities.map((item)=><CommunityCard key={item.id} item={item} compact/>) : <EmptyState text="Ты ещё не голосовал за сообщества."/>}</div>}
          {profilePage==='favorites' && <div className="community-list">{favCommunities.length ? favCommunities.map((item)=><CommunityCard key={item.id} item={item} compact/>) : <EmptyState text="В избранном пока пусто. Сохраняй понравившиеся сообщества закладкой."/>}</div>}
        </div>}
      </>}
    </>
  );

  const renderNotifications = () => (
    <>
      <PageHeader eyebrow="ЦЕНТР УВЕДОМЛЕНИЙ" title="Уведомления" subtitle="Новости о статусах твоих публикаций и действиях модерации." action={<button className="icon-button" onClick={()=>loadMe().catch(e=>notify(e.message))}><RefreshCw size={17}/></button>}/>
      {!initData ? <TelegramGate/> : <div className="notifications-page"><button className="secondary-button full notes-read-button" onClick={async()=>{try{await api('notes_read');await loadMe();notify('Уведомления отмечены прочитанными');}catch(e){notify(e.message);}}}>Отметить прочитанными</button><div className="notes-list">{unreadNotes.length ? unreadNotes.map((note,index)=><div className="note-card" key={`${note.at}-${index}`}><Bell size={16}/><div><b>{note.title}</b><p>{note.body}</p><small>{note.at ? new Date(note.at).toLocaleString('ru-RU') : ''}</small></div></div>) : <EmptyState text="Новых уведомлений пока нет."/>}</div></div>}
    </>
  );

  const renderAdmin = () => (
    <>
      <PageHeader eyebrow="УПРАВЛЕНИЕ ПЛАТФОРМОЙ" title="Панель модерации" subtitle="Модерация заявок, контроль публикаций и статистика." action={<button className="icon-button" onClick={()=>loadAdmin().catch(e=>notify(e.message))}><RefreshCw size={17}/></button>}/>
      {!initData ? <TelegramGate/> : !isStaff ? <EmptyState text="У этой учётной записи нет доступа к панели модерации."/> : <div className="admin-page">
        <div className="metric-grid admin-metrics">{[['Пользователи',stats?.users],['Онлайн 24 ч.',stats?.active24h],['На модерации',stats?.pending],['Голосов',stats?.votes]].map(([label,value])=><div className="admin-stat" key={label}><b>{fmt(value)}</b><small>{label}</small></div>)}</div>
        <div className="section-head"><h3>Очередь модерации</h3><button className="text-action" onClick={()=>loadAdmin()}>Обновить</button></div>
        {queue.length?queue.map(item=><article className="queue-item" key={item.id}>
          <button className="queue-item-open" onClick={()=>setSelectedQueueItem(item)}>
            <span className="queue-item-topline"><b>{item.title}</b><span className="status status-pending">На модерации</span></span>
            <small>@{item.username || 'ссылка не указана'} · {item.category || 'Без категории'} · {item.owner || 'Пользователь Telegram'}</small>
            <p>{item.description || 'Описание не добавлено.'}</p>
            <span className="queue-open-hint">Открыть подробности заявки <ChevronRight size={15}/></span>
          </button>
          <div className="queue-actions">{canModerate && <><button className="approve-button" onClick={()=>moderate(item,'approved')}><Check size={15}/> Одобрить</button><button className="reject-button" onClick={()=>{setSelectedQueueItem(null);setRejecting(item);setRejectReason('');}}><X size={15}/> Отклонить</button></>}</div>
        </article>):<EmptyState text="Очередь модерации пуста."/>}
        <div className="section-head"><h3>Публикации</h3><button className="text-action" onClick={()=>setShowDeleted(!showDeleted)}>{showDeleted?'Активные':'Удалённые'}</button></div>
        {canManage && adminItems.map(item=><div className="my-pub" key={item.id}><div><b>{item.title}</b><small>@{item.username} · {item.status}</small></div>{showDeleted?<button className="icon-button" onClick={()=>adminRestore(item)}><RefreshCw size={16}/></button>:<button className="icon-button danger" onClick={()=>adminDelete(item)}><Trash2 size={16}/></button>}</div>)}
      </div>}
    </>
  );

  const body = tab === 'home' ? renderHome() : tab === 'catalog' ? renderCatalog() : tab === 'add' ? renderAdd() : tab === 'rating' ? renderRating() : tab === 'notifications' ? renderNotifications() : tab === 'admin' ? renderAdmin() : renderProfile();

  return (
    <div className="app-shell">
      <header className="topbar"><button className="brand" onClick={openHome} aria-label="Bendor-X — главная"><span className="brand-mark" aria-hidden="true"><b>B</b><i>X</i></span><span className="brand-name">Bendor<span>-X</span><small>TELEGRAM DISCOVERY</small></span></button><div className="topbar-actions"><button className="icon-button" onClick={()=>setSearchOpen(!searchOpen)} aria-label="Поиск"><Search size={18}/></button><button className="icon-button" onClick={()=>setTab('profile')} aria-label="Профиль"><Users size={18}/></button></div></header>
      {searchOpen && <div className="global-search"><Search size={18}/><input autoFocus value={query} onChange={(e)=>setQuery(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter'){setTab('catalog');loadPublic({query:e.target.value});setSearchOpen(false);}}} placeholder="Найти сообщество…"/><button onClick={()=>setSearchOpen(false)}><X size={17}/></button></div>}
      <main className="main-content">
        {error && <div className="error-banner"><span>{error}</span><button onClick={()=>refresh()}><RefreshCw size={15}/> Повторить</button></div>}
        {loading || !loaderMinimumDone ? <BootLoader /> : body}
      </main>
      <nav className={`bottom-nav ${mobileMenu?'nav-open':''}`}>{nav.map(([id,Icon,label])=><button key={id} className={`${tab===id?'active':''} ${id==='add'?'add-nav':''}`} onClick={()=>{if(id==='home')openHome();else if(id==='catalog')openCategories();else setTab(id);setMobileMenu(false);}}><span><Icon size={id==='add'?22:19}/></span><small>{label}</small></button>)}</nav>
      {toast && <div className="toast-message">{toast}</div>}
      {refreshing && <div className="refresh-indicator"><LoaderCircle className="spin" size={15}/> Обновляем данные</div>}
      {promotionOpen && <div className="modal-backdrop" onClick={()=>setPromotionOpen(false)}>
        <section className="promotion-modal" onClick={(e)=>e.stopPropagation()}>
          <button className="modal-close" onClick={()=>setPromotionOpen(false)} aria-label="Закрыть"><X size={18}/></button>
          <div className="eyebrow"><Star size={13}/> ПРОДВИЖЕНИЕ ЗА TELEGRAM STARS</div>
          <h2>Выставить канал на продвижение</h2>
          <p className="promotion-modal-copy">Выбери своё опубликованное сообщество и срок рекламного размещения.</p>
          {!initData ? <TelegramGate/> : <>
            <label>Моё сообщество</label>
            <select className="promotion-select" value={promotionCommunityId} onChange={(e)=>setPromotionCommunityId(e.target.value)}>
              <option value="">Выбери опубликованный канал</option>
              {myCommunities.filter(item=>item.status==='approved').map(item=><option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
            <label>Срок размещения</label>
            <div className="promotion-duration-row">{[['1','1 день'],['3','3 дня'],['7','7 дней']].map(([value,label])=><button type="button" key={value} className={promotionDuration===value?'active':''} onClick={()=>setPromotionDuration(value)}>{label}</button>)}</div>
            {!myCommunities.some(item=>item.status==='approved') && <p className="promotion-modal-copy">Сначала добавь канал и дождись одобрения модератора. После этого он появится здесь.</p>}
            <div className="promotion-coming-soon"><Star size={17}/> Оплата Telegram Stars подключается на серверной стороне. Покупка пока недоступна.</div>
            <button className="primary-button full" disabled={!promotionCommunityId || !myCommunities.some(item=>Number(item.id)===Number(promotionCommunityId) && item.status==='approved')}>Оплатить Stars — скоро</button>
          </>}
        </section>
      </div>}
      {selectedQueueItem && <div className="modal-backdrop queue-detail-backdrop" onClick={()=>setSelectedQueueItem(null)}>
        <section className="queue-detail-modal" onClick={(e)=>e.stopPropagation()}>
          <button className="modal-close" onClick={()=>setSelectedQueueItem(null)} aria-label="Закрыть"><X size={18}/></button>
          <div className="eyebrow">ЗАЯВКА НА МОДЕРАЦИЮ · №{selectedQueueItem.id}</div>
          <div className="queue-channel-preview">
            {selectedQueueItem.avatar_path
              ? <img src={`${CFG.url}/storage/v1/object/public/community-media/${selectedQueueItem.avatar_path}`} alt={`Фотография канала ${selectedQueueItem.title}`} />
              : <div className="queue-channel-preview-fallback">{(selectedQueueItem.title || '?').slice(0, 1).toUpperCase()}</div>}
            <div><h2>{selectedQueueItem.title}</h2><small>{selectedQueueItem.username ? '@' + selectedQueueItem.username : 'Telegram-сообщество'}</small></div>
          </div>
          <span className="status status-pending">На модерации</span>
          <div className="queue-detail-section">
            <h3><FileText size={16}/> Описание</h3>
            <p>{selectedQueueItem.description || 'Отправитель не добавил описание.'}</p>
          </div>
          <div className="queue-detail-grid">
            <div><small>Категория</small><b>{selectedQueueItem.category || 'Не указана'}</b></div>
            <div><small>Тип сообщества</small><b>{selectedQueueItem.kind === 'channel' ? 'Канал' : selectedQueueItem.kind === 'supergroup' ? 'Супергруппа' : 'Группа / чат'}</b></div>
            <div><small>Отправлено</small><b>{selectedQueueItem.at ? new Date(selectedQueueItem.at).toLocaleString('ru-RU') : 'Дата не указана'}</b></div>
            <div><small>Теги</small><b>{Array.isArray(selectedQueueItem.tags) && selectedQueueItem.tags.length ? selectedQueueItem.tags.join(', ') : 'Нет тегов'}</b></div>
          </div>
          <div className="queue-detail-section">
            <h3><Send size={16}/> Telegram-сообщество</h3>
            <b className="queue-detail-username">@{selectedQueueItem.username || 'username не указан'}</b>
            <button className="secondary-button full" disabled={!selectedQueueItem.username} onClick={()=>openTelegram(selectedQueueItem.username)}>Открыть канал в Telegram <ExternalLink size={15}/></button>
          </div>
          <div className="queue-detail-section queue-sender-section">
            <h3><Users size={16}/> Кто отправил заявку</h3>
            <div className="queue-sender-card">
              <span className="queue-sender-avatar">{(selectedQueueItem.owner || 'П').slice(0,1).toUpperCase()}</span>
              <span><b>{selectedQueueItem.owner || 'Пользователь Telegram'}</b><small>{selectedQueueItem.owner_username ? '@' + String(selectedQueueItem.owner_username).replace(/^@/,'') : 'Telegram username не указан'}</small>{selectedQueueItem.owner_tid && <small>ID: {selectedQueueItem.owner_tid}</small>}</span>
            </div>
            <button className="secondary-button full" disabled={!selectedQueueItem.owner_username && !selectedQueueItem.owner_tid} onClick={()=>openTelegramUser(selectedQueueItem.owner_username,selectedQueueItem.owner_tid)}>Открыть профиль отправителя <ExternalLink size={15}/></button>
            {!selectedQueueItem.owner_username && !selectedQueueItem.owner_tid && <p className="queue-profile-hint">Данные профиля появятся после применения SQL-миграции в Supabase.</p>}
          </div>
          {canModerate && <div className="queue-detail-actions">
            <button className="approve-button" onClick={()=>moderate(selectedQueueItem,'approved')}><Check size={16}/> Одобрить заявку</button>
            <button className="reject-button" onClick={()=>{setRejecting(selectedQueueItem);setSelectedQueueItem(null);setRejectReason('');}}><X size={16}/> Отклонить</button>
          </div>}
        </section>
      </div>}
      {details && <div className="modal-backdrop" onClick={()=>setDetails(null)}><section className="detail-modal" onClick={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setDetails(null)}><X size={18}/></button><div className="detail-avatar">{avatarUrl(details)?<img src={avatarUrl(details)} alt=""/>:(details.title||'?').slice(0,1)}</div><div className="eyebrow">{details.category || categoryLabel(details.category_id)}</div><h2>{details.title}</h2><p className="detail-username">@{details.username}</p><p>{details.description || 'Описание не добавлено.'}</p><div className="detail-stats"><Metric icon={Trophy} value={fmt(details.rank)} label="Место"/><Metric icon={ThumbsUp} value={fmt(details.votes)} label="Голоса"/><Metric icon={Flame} value={`+${fmt(details.growth)}`} label="За неделю"/></div><div className="detail-actions"><button className="primary-button" onClick={()=>changeVote(details.id)}>{votedIds.has(Number(details.id))?'Отменить голос':'Проголосовать'}</button><button className="secondary-button" onClick={()=>openCommunityTelegram(details)}>Открыть в Telegram <ExternalLink size={15}/></button></div></section></div>}
      {rejecting && <div className="modal-backdrop" onClick={()=>setRejecting(null)}><section className="confirm-modal" onClick={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setRejecting(null)}><X size={18}/></button><h2>Отклонить публикацию</h2><p>{rejecting.title}</p><label>Причина (минимум 3 символа)</label><textarea rows={3} value={rejectReason} onChange={(e)=>setRejectReason(e.target.value)} placeholder="Укажи причину отказа"/><button className="reject-button full" disabled={rejectReason.trim().length<3} onClick={()=>moderate(rejecting,'rejected',rejectReason)}>Подтвердить отклонение</button></section></div>}
      <footer className="footer-note">Bendor-X · Каталог Telegram-сообществ</footer>
    </div>
  );
}


function BootLoader() {
  return (
    <div className="boot-loader" role="status" aria-label="Загрузка Bendor-X">
      <div className="boot-loader-glow" />
      <svg className="boot-loader-head" viewBox="0 0 420 340" aria-hidden="true">
        <defs>
          <linearGradient id="bx-metal" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f0edff" />
            <stop offset=".42" stopColor="#77718f" />
            <stop offset="1" stopColor="#242235" />
          </linearGradient>
          <linearGradient id="bx-purple" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e1baff" />
            <stop offset="1" stopColor="#7547ff" />
          </linearGradient>
          <filter id="bx-eye-glow" x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {/* Eyes ignite first; the head and hood are drawn around them. */}
        <g className="boot-eyes" filter="url(#bx-eye-glow)">
          <path d="M145 151 L198 169 L181 187 L154 179 Z" fill="url(#bx-purple)" />
          <path d="M238 184 L278 171 L266 192 L244 198 Z" fill="url(#bx-purple)" />
        </g>
        <g className="boot-draw">
          {/* Hood silhouette */}
          <path d="M83 269 C54 231 49 178 68 125 C87 73 133 37 196 29 C263 21 323 56 348 111 C369 157 365 215 340 266"
            fill="none" stroke="url(#bx-metal)" strokeWidth="13" strokeLinecap="round" />
          <path d="M99 267 C80 224 78 177 94 132 C111 84 151 58 202 54 C254 51 300 78 322 122"
            fill="none" stroke="#8f83ff" strokeOpacity=".7" strokeWidth="3" />
          {/* Headphones */}
          <path d="M72 135 C48 139 35 160 38 190 L45 222 C49 242 66 253 85 247 L99 241 L91 126 Z"
            fill="#171622" stroke="url(#bx-metal)" strokeWidth="8" />
          <ellipse cx="58" cy="190" rx="23" ry="39" fill="#211e35" stroke="#9c8cff" strokeWidth="5" />
          <ellipse cx="58" cy="190" rx="13" ry="27" fill="none" stroke="#6551d7" strokeWidth="3" />
          <path d="M344 132 C370 137 384 158 381 190 L374 221 C370 241 353 252 334 246 L321 240 L329 126 Z"
            fill="#171622" stroke="url(#bx-metal)" strokeWidth="8" />
          <ellipse cx="362" cy="190" rx="23" ry="39" fill="#211e35" stroke="#9c8cff" strokeWidth="5" />
          <ellipse cx="362" cy="190" rx="13" ry="27" fill="none" stroke="#6551d7" strokeWidth="3" />
          {/* Face frame and mask */}
          <path d="M105 118 C127 83 166 69 211 70 C258 71 294 91 316 126 L303 221 C295 260 260 285 211 291 C163 286 127 261 117 222 Z"
            fill="#11121b" stroke="url(#bx-metal)" strokeWidth="8" />
          <path d="M119 129 C148 104 178 95 211 96 C245 96 277 108 300 132"
            fill="none" stroke="#6f61bd" strokeWidth="4" />
          <path d="M128 218 C151 247 178 260 211 264 C245 260 274 245 294 218"
            fill="none" stroke="#77718f" strokeWidth="5" />
          <path d="M171 278 L211 302 L252 278" fill="none" stroke="#8b7cff" strokeWidth="4" strokeLinecap="round" />
        </g>
      </svg>
      <div className="boot-loader-wordmark">Bendor<span>-X</span></div>
      <div className="boot-loader-track"><span /></div>
      <div className="boot-loader-caption">ЗАГРУЗКА</div>
    </div>
  );
}

function EmptyState({ text }) { return <div className="empty-state"><span><Search size={22}/></span><p>{text}</p></div>; }
function Metric({ icon: Icon, value, label }) { return <div className="metric"><span><Icon size={16}/></span><b>{value}</b><small>{label}</small></div>; }
function TelegramGate() {
  const webApp = window.Telegram?.WebApp;
  const hashHasLaunchData = window.location.hash.includes('tgWebAppData');
  const queryHasLaunchData = new URLSearchParams(window.location.search).has('tgWebAppData');
  return <div className="telegram-gate">
    <span><LogIn size={25}/></span><h3>Открой Bendor-X в Telegram</h3>
    <p>Для голосования, избранного, публикаций и профиля нужна подтверждённая авторизация Telegram.</p>
    <a href="https://t.me/BendorX_bot" target="_blank" rel="noreferrer">Перейти к боту <ArrowRight size={15}/></a>
    <div style={{marginTop:16,padding:12,borderRadius:10,background:'rgba(255,255,255,.05)',textAlign:'left',fontSize:12,lineHeight:1.8}}>
      <b>Диагностика запуска (без личных данных)</b><br/>
      Telegram SDK: {window.Telegram ? 'подключён' : 'не найден'}<br/>
      WebApp: {webApp ? 'доступен' : 'не найден'}<br/>
      initData: {webApp?.initData ? 'получен' : 'пустой'} (длина: {webApp?.initData?.length || 0})<br/>
      Данные пользователя: {webApp?.initDataUnsafe?.user ? 'получены' : 'не получены'}<br/>
      Параметры запуска в адресе: {hashHasLaunchData || queryHasLaunchData ? 'есть' : 'не обнаружены'}<br/>
      Платформа: {webApp?.platform || 'не определена'} · Версия: {webApp?.version || 'не определена'}
    </div>
  </div>;
}