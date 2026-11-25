import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Activity, ArrowDownUp, ArrowLeft, ArrowRight, Bell, Bookmark, Check,
  ChevronDown, ChevronRight, CircleHelp, Clock3, Crown, ExternalLink, Eye, FileText,
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
const CARD_THEMES = [{"id":"violet","label":"Фиолетовый","a":"#30245f","b":"#7655d9"},{"id":"ocean","label":"Океан","a":"#123b59","b":"#1689a8"},{"id":"sunset","label":"Закат","a":"#642b42","b":"#d66b54"},{"id":"emerald","label":"Изумруд","a":"#124c43","b":"#229b76"},{"id":"ruby","label":"Рубин","a":"#5c2037","b":"#bd4564"},{"id":"gold","label":"Золото","a":"#59421e","b":"#bd8a36"},{"id":"blue","label":"Синий","a":"#1c3268","b":"#456ed0"},{"id":"midnight","label":"Ночь","a":"#252b42","b":"#59627e"}];

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
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loaderAnimationDone, setLoaderAnimationDone] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setLoaderAnimationDone(true), 2200);
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
  const [add, setAdd] = useState({ title: '', link: '', description: '', category: '', kind: 'channel', tags: '', card_theme: 'violet' });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [queue, setQueue] = useState([]);
  const [selectedQueueItem, setSelectedQueueItem] = useState(null);
  const [stats, setStats] = useState(null);
  const [adminItems, setAdminItems] = useState([]);
  const [staffQuery, setStaffQuery] = useState('');
  const [staffResult, setStaffResult] = useState(null);
  const [staffMembers, setStaffMembers] = useState([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffSaving, setStaffSaving] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [showAllHomeCategories, setShowAllHomeCategories] = useState(false);
  const [homeSort, setHomeSort] = useState('votes');
  const [voteConfirmIds, setVoteConfirmIds] = useState(() => new Set());

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

  const loadStaff = useCallback(async () => {
    if (!initData || me?.role !== 'master_admin') return;
    setStaffLoading(true);
    try { setStaffMembers(await api('staff_list') || []); }
    finally { setStaffLoading(false); }
  }, [api, initData, me?.role]);

  const searchStaff = async () => {
    if (!staffQuery.trim()) return notify('Введи Telegram ID или username.');
    setStaffLoading(true);
    setStaffResult(null);
    try { setStaffResult(await api('staff_search', { query: staffQuery.trim() })); }
    catch (err) { notify(err.message); }
    finally { setStaffLoading(false); }
  };

  const changeStaffRole = async (person, role) => {
    const label = role === 'admin' ? 'администратором' : role === 'moderator' ? 'модератором' : 'обычным пользователем';
    if (!window.confirm(`Изменить роль пользователя ${person.name || person.username || person.tid} на «${label}»?`)) return;
    setStaffSaving(true);
    try {
      await api('staff_set_role', { target_tid: person.tid, role });
      const updated = { ...person, role };
      setStaffResult(updated);
      await loadStaff();
      await loadMe();
      notify(role === 'user' ? 'Права пользователя сняты' : 'Роль успешно назначена');
    } catch (err) { notify(err.message); }
    finally { setStaffSaving(false); }
  };

  const refresh = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError('');
    let timeoutId;
    try {
      await Promise.race([
        (async () => {
          if (!initData) {
            setSubscription({ subscribed: false, reason: 'telegram' });
            setMe(null);
            return;
          }
          const access = await api('check_subscription');
          setSubscription(access || { subscribed: false });
          if (!access?.subscribed) {
            setMe(null);
            return;
          }
          await loadPublic();
          await loadMe();
        })(),
        new Promise((_, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(new Error('Сервер не ответил за 15 секунд. Проверь интернет и нажми «Повторить».'));
          }, 15000);
        })
      ]);
    } catch (err) {
      setSubscription({ subscribed: false, reason: 'error' });
      setError(err.message || 'Не удалось проверить подписку');
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, loadPublic, loadMe, initData]);

  useEffect(() => {
    try { tg?.ready?.(); tg?.expand?.(); tg?.setHeaderColor?.('#111318'); tg?.setBackgroundColor?.('#111318'); } catch {}
    refresh();
  }, []);

  useEffect(() => {
    if (me && isStaff) loadAdmin().catch((err) => notify(err.message));
    if (me?.role === 'master_admin' && tab === 'admin') loadStaff().catch((err) => notify(err.message));
  }, [me?.role, showDeleted, tab]);

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
      const removingVote = votedIds.has(Number(id));
      if (removingVote) {
        await api('unvote', { id });
        setVoteConfirmIds((current) => {
          const next = new Set(current);
          next.delete(Number(id));
          return next;
        });
      } else {
        await api('vote', { id });
      }
      await reloadEverything();
      if (!removingVote) {
        const voteId = Number(id);
        setVoteConfirmIds((current) => new Set(current).add(voteId));
        window.setTimeout(() => {
          setVoteConfirmIds((current) => {
            const next = new Set(current);
            next.delete(voteId);
            return next;
          });
        }, 1500);
      }
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
        category: Number(add.category), kind: add.kind, card_theme: add.card_theme, card_emoji: null,
        tags: add.tags.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 5).join(','), avatar
      });
      setAdd({ title: '', link: '', description: '', category: '', kind: 'channel', tags: '', card_theme: 'violet' });
      setImageFile(null); setImagePreview('');
      await reloadEverything(); setTab('profile-publications');
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
    <article className={`community-card ${compact ? 'compact' : ''} card-theme-${CARD_THEMES.some((theme) => theme.id === item.card_theme) ? item.card_theme : 'default'}`}>
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
        <button className={`icon-button favorite-button ${favoriteIds.has(Number(item.id)) ? 'favorite-selected' : ''}`} title="Избранное" onClick={() => changeFavorite(item.id)}><Bookmark size={17}/></button>
        <button className={`vote-button ${voteConfirmIds.has(Number(item.id)) ? 'vote-confirmed' : ''}`} onClick={() => { if (!votedIds.has(Number(item.id))) changeVote(item.id); }}>
          {voteConfirmIds.has(Number(item.id)) ? <Check size={15}/> : <ThumbsUp size={15}/>} {voteConfirmIds.has(Number(item.id)) ? 'Голос засчитан' : 'Голос'}
        </button>
      </div>
    </article>
  );

  const PageHeader = ({ eyebrow, title, subtitle, action }) => {
    const showProfileBack = ['notifications', 'admin', 'profile-publications', 'profile-votes', 'profile-favorites'].includes(tab);
    return (
      <div className={`page-heading ${showProfileBack ? 'page-heading-with-back' : ''}`}>
        {showProfileBack && <button className="icon-button page-back-button" aria-label="Назад в профиль" title="Назад в профиль" onClick={() => setTab('profile')}><ArrowLeft size={19}/></button>}
        <div className="page-heading-copy">{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
        {action}
      </div>
    );
  };

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
        <label>Выбери категорию</label>
        <div className="category-grid add-category-grid" role="group" aria-label="Выбор категории">
          {categories.map((c,index)=>(
            <button type="button" key={c.id} className={`category-tile ${add.category===String(c.id)?'category-tile-active':''}`} aria-pressed={add.category===String(c.id)} onClick={()=>setAdd({...add,category:String(c.id)})}>
              <span className={`category-symbol tone-${index%6}`}>{c.icon || '✦'}</span>
              <span><b>{c.title}</b><small>{fmt(c.groups)} сообществ</small></span>
              <ChevronRight size={16}/>
            </button>
          ))}
        </div>
        {!add.category && <small className="add-category-hint">Выбери одну категорию для публикации.</small>}
        <label>Выбери фон карточки</label>
        <div className="card-theme-picker" role="group" aria-label="Выбор фона карточки">
          {CARD_THEMES.map((theme) => <button type="button" key={theme.id} className={`card-theme-option card-theme-${theme.id} ${add.card_theme === theme.id ? 'chosen' : ''}`} aria-pressed={add.card_theme === theme.id} onClick={() => setAdd({ ...add, card_theme: theme.id })}><span className="card-theme-swatch"/><b>{theme.label}</b>{add.card_theme === theme.id && <Check size={14}/>}</button>)}
        </div>
        <div className={`card-live-preview card-theme-${add.card_theme}`}>
          <div className="card-preview-content"><small>ПРЕДПРОСМОТР КАРТОЧКИ</small><b>{add.title.trim() || 'Название твоего канала'}</b><span>{add.description.trim() || 'Здесь будет отображаться описание сообщества'}</span></div>
        </div>
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
              <tr key={item.id} className={index < 3 ? `leaderboard-medal-row medal-${index+1}` : ''}>
                <td><span className={`leaderboard-place place-${index+1}`}>{index===0 && <Crown className="leaderboard-crown" size={17} strokeWidth={2.4}/>}<span>{index+1}</span></span></td>
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
          <button onClick={()=>setTab('profile-publications')}><FileText/><span><b>Мои публикации</b><small>Статус заявок и статистика</small></span><ChevronRight/></button>
          <button onClick={()=>setTab('profile-votes')}><ThumbsUp/><span><b>Мои голосования</b><small>Сообщества, за которые ты голосовал</small></span><ChevronRight/></button>
          <button onClick={()=>setTab('profile-favorites')}><Bookmark/><span><b>Избранное</b><small>Сохранённые сообщества</small></span><ChevronRight/></button>
          <button onClick={()=>setTab('notifications')}><Bell/><span><b>Уведомления</b><small>Отдельная страница уведомлений</small></span><ChevronRight/></button>
          {isStaff && <button onClick={()=>{setTab('admin');loadAdmin().catch(e=>notify(e.message));}}><LayoutDashboard/><span><b>Панель управления</b><small>Отдельная страница модерации</small></span><ChevronRight/></button>}
        </div>
      </>}
    </>
  );

  const renderProfileSubpage = (page, title, subtitle, content) => (
    <>
      <PageHeader eyebrow="ЛИЧНЫЙ КАБИНЕТ" title={title} subtitle={subtitle}/>
      {!initData ? <TelegramGate/> : content}
    </>
  );

  const renderMyPublications = () => renderProfileSubpage(
    'publications', 'Мои публикации', 'Статус заявок и статистика твоих сообществ.',
    <div className="my-pubs">{myCommunities.length ? myCommunities.map((item)=><div className="my-pub" key={item.id}><div><b>{item.title}</b><small>@{item.username} · {fmt(item.votes)} голосов</small></div><span className={`status status-${item.status}`}>{STATUS[item.status]?.[0] || item.status}</span></div>) : <EmptyState text="У тебя пока нет публикаций."/>}</div>
  );

  const renderMyVotes = () => renderProfileSubpage(
    'votes', 'Мои голосования', 'Сообщества, за которые ты отдавал голос.',
    <div className="community-list">{votedCommunities.length ? votedCommunities.map((item)=><CommunityCard key={item.id} item={item} compact/>) : <EmptyState text="Ты ещё не голосовал за сообщества."/>}</div>
  );

  const renderMyFavorites = () => renderProfileSubpage(
    'favorites', 'Избранное', 'Сохранённые сообщества.',
    <div className="community-list">{favCommunities.length ? favCommunities.map((item)=><CommunityCard key={item.id} item={item} compact/>) : <EmptyState text="В избранном пока пусто. Сохраняй понравившиеся сообщества закладкой."/>}</div>
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
        {me?.role === 'master_admin' && <section className="staff-management">
          <div className="section-head"><div><h3>Управление персоналом</h3><p className="staff-caption">Назначай администраторов и модераторов по Telegram ID или username.</p></div><button className="text-action" onClick={()=>loadStaff().catch(e=>notify(e.message))}>Обновить</button></div>
          <div className="staff-search-row">
            <input value={staffQuery} onChange={e=>setStaffQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')searchStaff();}} placeholder="Telegram ID или @username"/>
            <button className="primary-button" disabled={staffLoading} onClick={searchStaff}><Search size={15}/> Найти</button>
          </div>
          {staffResult && <div className="staff-person staff-search-result">
            <div className="staff-person-info"><b>{staffResult.name || 'Пользователь Telegram'}</b><small>{staffResult.username ? '@'+staffResult.username+' · ' : ''}ID: {staffResult.tid}</small><span className="role-pill">Текущая роль: {staffResult.role}</span></div>
            {staffResult.role !== 'master_admin' && <div className="staff-actions">
              <button disabled={staffSaving} onClick={()=>changeStaffRole(staffResult,'admin')}>Админ</button>
              <button disabled={staffSaving} onClick={()=>changeStaffRole(staffResult,'moderator')}>Модератор</button>
              <button className="staff-remove" disabled={staffSaving || staffResult.role==='user'} onClick={()=>changeStaffRole(staffResult,'user')}>Снять роль</button>
            </div>}
          </div>}
          <div className="section-head staff-list-heading"><h3>Действующие администраторы и модераторы</h3><span className="staff-count">{staffMembers.length}</span></div>
          {staffLoading && !staffMembers.length ? <div className="staff-empty">Загрузка списка…</div> : staffMembers.length ? staffMembers.map(person=><div className="staff-person" key={person.tid}>
            <div className="staff-person-info"><b>{person.name || 'Пользователь Telegram'}</b><small>{person.username ? '@'+person.username+' · ' : ''}ID: {person.tid}</small><span className={`staff-role role-${person.role}`}>{person.role==='master_admin'?'Главный администратор':person.role==='admin'?'Администратор':'Модератор'}</span></div>
            {person.role !== 'master_admin' && <div className="staff-actions"><button disabled={staffSaving} onClick={()=>changeStaffRole(person,person.role==='admin'?'moderator':'admin')}>{person.role==='admin'?'В модераторы':'В админы'}</button><button className="staff-remove" disabled={staffSaving} onClick={()=>changeStaffRole(person,'user')}>Снять</button></div>}
          </div>) : <div className="staff-empty">Пока нет назначенных сотрудников.</div>}
          <p className="staff-footnote">Поиск работает среди пользователей, которые хотя бы раз открывали Bendor-X. Главный администратор защищён от изменения роли.</p>
        </section>}
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

  const body = tab === 'home' ? renderHome() : tab === 'catalog' ? renderCatalog() : tab === 'add' ? renderAdd() : tab === 'rating' ? renderRating() : tab === 'notifications' ? renderNotifications() : tab === 'admin' ? renderAdmin() : tab === 'profile-publications' ? renderMyPublications() : tab === 'profile-votes' ? renderMyVotes() : tab === 'profile-favorites' ? renderMyFavorites() : renderProfile();
  const appContent = subscription?.subscribed ? body : <SubscriptionGate onCheck={() => refresh(true)} checking={refreshing} reason={subscription?.reason} error={error} />;

  return (
    <div className="app-shell">
      <header className="topbar"><button className="brand" onClick={openHome} aria-label="Bendor-X — главная"><span className="brand-mark" aria-hidden="true"><b>B</b><i>X</i></span><span className="brand-name">Bendor<span className="brand-suffix"><span className="brand-hyphen">-</span><span className="brand-x">X</span></span><small>TELEGRAM DISCOVERY</small></span></button><div className="topbar-actions"><button className="icon-button" onClick={()=>setSearchOpen(!searchOpen)} aria-label="Поиск"><Search size={18}/></button><button className="icon-button" onClick={()=>setTab('profile')} aria-label="Профиль"><Users size={18}/></button></div></header>
      {searchOpen && <div className="global-search"><Search size={18}/><input autoFocus value={query} onChange={(e)=>setQuery(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter'){setTab('catalog');loadPublic({query:e.target.value});setSearchOpen(false);}}} placeholder="Найти сообщество…"/><button onClick={()=>setSearchOpen(false)}><X size={17}/></button></div>}
      <main className="main-content">
        {error && <div className="error-banner"><span>{error}</span><button onClick={()=>refresh()}><RefreshCw size={15}/> Повторить</button></div>}
        {appContent}
        {(loading || !loaderAnimationDone) && <BootLoader />}
      </main>
      <nav className={`bottom-nav ${mobileMenu?'nav-open':''}`} style={{'--nav-index': Math.max(0, nav.findIndex(([id]) => tab === id || (id === 'profile' && tab.startsWith('profile-'))))}} aria-label="Основная навигация"><span className="nav-active-indicator" aria-hidden="true"/>{nav.map(([id,Icon,label])=><button key={id} type="button" className={`nav-${id} ${(tab===id || (id==='profile' && tab.startsWith('profile-')))?'active':''} ${id==='add'?'add-nav':''}`} aria-label={label} aria-current={(tab===id || (id==='profile' && tab.startsWith('profile-')))?'page':undefined} onClick={()=>{if(id==='home')openHome();else if(id==='catalog')openCategories();else if(id==='profile'){setTab('profile');}else setTab(id);setMobileMenu(false);}}><span className="nav-icon-wrap"><Icon className="nav-icon" size={id==='add'?22:19}/></span><small>{label}</small></button>)}</nav>
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
            <div><small>Тип сообщества</small><b>{['channel','telegram_channel'].includes(String(selectedQueueItem.kind || '').toLowerCase()) ? 'Канал' : ['supergroup','group','chat'].includes(String(selectedQueueItem.kind || '').toLowerCase()) ? 'Группа / чат' : 'Тип не указан'}</b></div>
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
      {details && <div className="modal-backdrop" onClick={()=>setDetails(null)}><section className={`detail-modal card-theme-${CARD_THEMES.some((theme) => theme.id === details.card_theme) ? details.card_theme : 'default'}`} onClick={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setDetails(null)}><X size={18}/></button><div className="detail-avatar">{avatarUrl(details)?<img src={avatarUrl(details)} alt=""/>:(details.title||'?').slice(0,1)}</div><div className="eyebrow">{details.category || categoryLabel(details.category_id)}</div><h2>{details.title}</h2><p className="detail-username">@{details.username}</p><p>{details.description || 'Описание не добавлено.'}</p><div className="detail-stats"><Metric icon={Trophy} value={fmt(details.rank)} label="Место"/><Metric icon={ThumbsUp} value={fmt(details.votes)} label="Голоса"/><Metric icon={Flame} value={`+${fmt(details.growth)}`} label="За неделю"/></div><div className="detail-actions"><button className="primary-button" onClick={()=>changeVote(details.id)}>{votedIds.has(Number(details.id))?'Отменить голос':'Проголосовать'}</button><button className="secondary-button" onClick={()=>openCommunityTelegram(details)}>Открыть в Telegram <ExternalLink size={15}/></button></div></section></div>}
      {rejecting && <div className="modal-backdrop" onClick={()=>setRejecting(null)}><section className="confirm-modal" onClick={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setRejecting(null)}><X size={18}/></button><h2>Отклонить публикацию</h2><p>{rejecting.title}</p><label>Причина (минимум 3 символа)</label><textarea rows={3} value={rejectReason} onChange={(e)=>setRejectReason(e.target.value)} placeholder="Укажи причину отказа"/><button className="reject-button full" disabled={rejectReason.trim().length<3} onClick={()=>moderate(rejecting,'rejected',rejectReason)}>Подтвердить отклонение</button></section></div>}
      <footer className="footer-note">Bendor-X · Каталог Telegram-сообществ</footer>
    </div>
  );
}


function BootLoader() {
  const letters = ['B', 'E', 'N', 'D', 'O', 'R', '-', 'X'];
  return (
    <div className="boot-loader" role="status" aria-label="Загрузка Bendor-X">
      <div className="boot-brand">
        <div className="boot-loader-wordmark" aria-label="BENDOR-X">
          {letters.map((letter, index) => (
            <span key={index} style={{'--letter-index': index}}>{letter}</span>
          ))}
        </div>
        <div className="boot-loader-tagline">Продвигай.Находи.Расти.</div>
      </div>
      <div className="boot-loader-track" aria-hidden="true"><span /></div>
    </div>
  );
}

function EmptyState({ text }) { return <div className="empty-state"><span><Search size={22}/></span><p>{text}</p></div>; }
function Metric({ icon: Icon, value, label }) { return <div className="metric"><span><Icon size={16}/></span><b>{value}</b><small>{label}</small></div>; }
function SubscriptionGate({ onCheck, checking, reason, error }) {
  const needsTelegram = reason === 'telegram';
  return (
    <section style={{minHeight:'58vh',display:'grid',placeItems:'center',padding:'24px 18px'}}>
      <div style={{width:'100%',maxWidth:430,padding:26,borderRadius:24,background:'linear-gradient(145deg,#1b1d29,#12141c)',border:'1px solid rgba(157,130,255,.28)',boxShadow:'0 24px 70px rgba(0,0,0,.35)',textAlign:'center'}}>
        <div style={{width:68,height:68,margin:'0 auto 18px',display:'grid',placeItems:'center',borderRadius:22,background:'rgba(130,98,255,.16)',color:'#b9a5ff'}}><ShieldCheck size={34}/></div>
        <div style={{fontSize:11,fontWeight:800,letterSpacing:2,color:'#a995ff',marginBottom:9}}>BENDOR-X · ДОСТУП</div>
        <h2 style={{fontSize:24,lineHeight:1.2,margin:'0 0 10px',color:'#fff'}}>Подпишись на наш канал</h2>
        <p style={{fontSize:14,lineHeight:1.6,color:'#aeb0c0',margin:'0 0 22px'}}>Чтобы пользоваться Bendor-X, подпишись на официальный канал и нажми кнопку проверки.</p>
        <a href="https://t.me/BendorX" target="_blank" rel="noreferrer" style={{display:'flex',justifyContent:'center',alignItems:'center',gap:9,width:'100%',boxSizing:'border-box',padding:'14px 18px',borderRadius:14,background:'linear-gradient(100deg,#7657e8,#9b70ff)',color:'#fff',fontWeight:800,textDecoration:'none',marginBottom:11}}><ExternalLink size={17}/> Подписаться на @BendorX</a>
        <button type="button" onClick={onCheck} disabled={checking || needsTelegram} style={{width:'100%',padding:'14px 18px',borderRadius:14,border:'1px solid rgba(255,255,255,.14)',background:'rgba(255,255,255,.06)',color:'#fff',fontWeight:750,opacity:checking || needsTelegram ? .55 : 1,cursor:checking || needsTelegram ? 'default' : 'pointer'}}>{checking ? 'Проверяем подписку…' : 'Я подписался — проверить'}</button>
        {needsTelegram && <p style={{fontSize:12,color:'#f0c879',margin:'14px 0 0'}}>Открой приложение через Telegram-бота, чтобы проверить аккаунт.</p>}
        {error && <p style={{fontSize:12,color:'#ff9a9a',margin:'12px 0 0'}}>{error}</p>}
      </div>
    </section>
  );
}

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