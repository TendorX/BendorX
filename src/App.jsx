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
  const [topCommunities, setTopCommunities] = useState([]);
  const [media, setMedia] = useState({});
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
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
  const [stats, setStats] = useState(null);
  const [adminItems, setAdminItems] = useState([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);

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
    if (!initData) throw new Error('Открой TendorX через Telegram, чтобы войти в аккаунт.');
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
    const [catResult, listResult, topResult, mediaResult] = await Promise.all([
      supabase.rpc('tx_categories'),
      supabase.rpc('tx_catalog', { p_q: q.trim() || null, p_cat: cat === 'all' ? null : Number(cat), p_sort: order, p_limit: 200 }),
      supabase.rpc('tx_catalog', { p_sort: 'top', p_limit: 8 }),
      supabase.rpc('tx_media')
    ]);
    if (catResult.error) throw catResult.error;
    if (listResult.error) throw listResult.error;
    setCategories(catResult.data || []);
    setCommunities(listResult.data || []);
    setTopCommunities(topResult.data || []);
    const map = {};
    (mediaResult.data || []).forEach((item) => { map[item.id] = item.avatar_path; });
    setMedia(map);
  }, [query, category, sort]);

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

  const openCommunity = async (item) => {
    setDetails(item);
    try { if (initData) await api('click', { id: item.id }); } catch {}
  };

  const openTelegram = (username) => {
    const link = telegramLink(username);
    if (tg?.openTelegramLink) tg.openTelegramLink(link);
    else window.open(link, '_blank', 'noopener,noreferrer');
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
      setRejecting(null); setRejectReason('');
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

  const filtered = communities;
  const favCommunities = useMemo(() => communities.filter((x) => favoriteIds.has(Number(x.id))), [communities, favoriteIds]);
  const votedCommunities = useMemo(() => communities.filter((x) => votedIds.has(Number(x.id))), [communities, votedIds]);
  const myCommunities = me?.communities || [];
  const categoryLabel = (id) => categories.find((x) => Number(x.id) === Number(id))?.title || 'Без категории';
  const avatarUrl = (item) => media[item.id] ? `${CFG.url}/storage/v1/object/public/community-media/${media[item.id]}` : '';

  const CommunityCard = ({ item, compact = false }) => (
    <article className={`community-card ${compact ? 'compact' : ''}`}>
      <button className="community-main" onClick={() => openCommunity(item)}>
        {avatarUrl(item) ? <img className="avatar" src={avatarUrl(item)} alt="" /> : <div className="avatar fallback">{(item.title || '?').slice(0, 1).toUpperCase()}</div>}
        <span className="community-copy">
          <strong>{item.title}</strong>
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
    ['home', Home, 'Главная'], ['favorites', Bookmark, 'Избранное'], ['add', Plus, 'Добавить'], ['rating', Trophy, 'Рейтинг'], ['profile', Users, 'Профиль']
  ];

  const renderHome = () => (
    <>
      <section className="hero-panel">
        <div className="hero-glow"/><div className="hero-content">
          <span className="hero-kicker"><Sparkles size={14}/> ПЛАТФОРМА TELEGRAM-СООБЩЕСТВ</span>
          <h1>Находи. Развивай.<br/><em>Будь заметнее.</em></h1>
          <p>Каталог каналов и сообществ Telegram с честным рейтингом и живой аудиторией.</p>
          <button className="primary-button" onClick={() => setTab('catalog')}>Открыть каталог <ArrowRight size={16}/></button>
        </div>
        <div className="hero-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="hero-cube"><Grid2X2 size={42}/></div><div className="float-chip chip-top"><Trophy size={15}/> Рейтинг</div><div className="float-chip chip-bottom"><Users size={15}/> Сообщества</div></div>
      </section>
      <div className="section-head"><div><div className="eyebrow">ОБЗОР</div><h2>Популярное сейчас</h2></div><button className="text-action" onClick={() => setTab('rating')}>Весь рейтинг <ArrowRight size={15}/></button></div>
      {topCommunities.length ? <div className="community-list">{topCommunities.slice(0, 5).map((item) => <CommunityCard key={item.id} item={item} compact/>)}</div> : <EmptyState text="Пока нет опубликованных сообществ."/>}
      <div className="section-head"><div><div className="eyebrow">НАВИГАЦИЯ</div><h2>Категории</h2></div><button className="text-action" onClick={() => setTab('catalog')}>Все категории <ArrowRight size={15}/></button></div>
      <div className="category-grid">{categories.slice(0, 8).map((item, index) => <button className="category-tile" key={item.id} onClick={() => {const next=String(item.id);setCategory(next);setTab('catalog');loadPublic({category:next});}}><span className={`category-symbol tone-${index % 6}`}>{item.icon || '✦'}</span><span><b>{item.title}</b><small>{fmt(item.groups)} сообществ</small></span><ChevronRight size={16}/></button>)}</div>
    </>
  );

  const renderCatalog = () => (
    <>
      <PageHeader eyebrow="ИССЛЕДУЙ TELEGRAM" title="Каталог" subtitle="Выбирай интересные каналы, группы и сообщества." action={<button className="icon-button" onClick={() => refresh(true)}><RefreshCw size={17}/></button>}/>
      <div className="search-box"><Search size={18}/><input value={query} onChange={(e) => {setQuery(e.target.value);}} onKeyDown={(e) => e.key === 'Enter' && loadPublic({query:e.target.value})} placeholder="Название, тематика или @username"/><button onClick={() => loadPublic()}><ArrowRight size={17}/></button></div>
      <div className="filter-row"><div className="filter-scroll"><button className={`filter-chip ${category === 'all' ? 'active' : ''}`} onClick={() => {setCategory('all');loadPublic({category:'all'});}}>Все</button>{categories.map((item) => <button key={item.id} className={`filter-chip ${category === String(item.id) ? 'active' : ''}`} onClick={() => {setCategory(String(item.id));loadPublic({category:String(item.id)});}}>{item.title}</button>)}</div><select className="sort-select" value={sort} onChange={(e) => {setSort(e.target.value);loadPublic({sort:e.target.value});}}><option value="top">Популярные</option><option value="growth">Растущие</option><option value="new">Новые</option></select></div>
      {filtered.length ? <div className="community-list">{filtered.map((item) => <CommunityCard key={item.id} item={item}/>)}</div> : <EmptyState text="Ничего не найдено. Попробуй изменить запрос или категорию."/>}
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
      <PageHeader eyebrow="ЧЕСТНЫЙ РЕЙТИНГ" title="Лучшие сообщества" subtitle="Позиции формируются по действительным голосам пользователей. Платные размещения не влияют на рейтинг."/>
      <div className="segmented"><button className={sort==='top'?'active':''} onClick={()=>{setSort('top');loadPublic({sort:'top'});}}>За всё время</button><button className={sort==='growth'?'active':''} onClick={()=>{setSort('growth');loadPublic({sort:'growth'});}}>За 7 дней</button><button className={sort==='new'?'active':''} onClick={()=>{setSort('new');loadPublic({sort:'new'});}}>Новые</button></div>
      <div className="ranking-list">{communities.map((item,index)=><article className="ranking-card" key={item.id}>
        <div className={`ranking-place place-${index+1}`}>{index+1}</div>
        {avatarUrl(item) ? <img className="ranking-avatar" src={avatarUrl(item)} alt=""/> : <div className="ranking-avatar fallback">{(item.title||'?').slice(0,1).toUpperCase()}</div>}
        <button className="ranking-info" onClick={()=>openCommunity(item)}><b>{item.title}</b><small>@{item.username || 'telegram'} · {item.category || categoryLabel(item.category_id)}</small><span><ThumbsUp size={13}/>{fmt(item.votes)} голосов <i>·</i> <Flame size={13}/>{fmt(item.growth)} за 7 дней</span></button>
        <div className="ranking-actions"><button className={`icon-button ${favoriteIds.has(Number(item.id))?'selected':''}`} onClick={()=>changeFavorite(item.id)} title="В избранное"><Bookmark size={16}/></button><button className={`vote-button ${votedIds.has(Number(item.id))?'voted':''}`} onClick={()=>changeVote(item.id)}>{votedIds.has(Number(item.id))?'Голос учтён':'Голосовать'}</button></div>
      </article>)}</div>
      {!communities.length && <EmptyState text="Пока нет сообществ для рейтинга."/>}
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
          <button onClick={()=>setTab('notifications')}><Bell/><span><b>Уведомления</b><small>Отдельная страница уведомлений</small></span><ChevronRight/></button>
          {isStaff && <button onClick={()=>{setTab('admin');loadAdmin().catch(e=>notify(e.message));}}><LayoutDashboard/><span><b>Панель управления</b><small>Отдельная страница модерации</small></span><ChevronRight/></button>}
        </div>
        {profilePage !== 'main' && <div className="subpage-panel"><div className="subpage-heading"><button className="icon-button" onClick={()=>setProfilePage('main')}><ArrowLeft size={17}/></button><h2>{profilePage==='publications'?'Мои публикации':'Мои голосования'}</h2></div>
          {profilePage==='publications' && <div className="my-pubs">{myCommunities.length ? myCommunities.map((item)=><div className="my-pub" key={item.id}><div><b>{item.title}</b><small>@{item.username} · {fmt(item.votes)} голосов</small></div><span className={`status status-${item.status}`}>{STATUS[item.status]?.[0] || item.status}</span></div>) : <EmptyState text="У тебя пока нет публикаций."/>}</div>}
          {profilePage==='votes' && <div className="community-list">{votedCommunities.length ? votedCommunities.map((item)=><CommunityCard key={item.id} item={item} compact/>) : <EmptyState text="Ты ещё не голосовал за сообщества."/>}</div>}
        </div>}
      </>}
    </>
  );

  const renderFavorites = () => (
    <>
      <PageHeader eyebrow="ТВОЯ КОЛЛЕКЦИЯ" title="Избранное" subtitle="Сообщества, которые ты сохранил." action={<button className="icon-button" onClick={()=>refresh(true)}><RefreshCw size={17}/></button>}/>
      {!initData ? <TelegramGate/> : <div className="community-list">{favCommunities.length ? favCommunities.map(item=><CommunityCard key={item.id} item={item}/>) : <EmptyState text="В избранном пока пусто. Нажми на закладку у понравившегося сообщества, чтобы сохранить его здесь."/>}</div>}
    </>
  );

  const renderNotifications = () => (
    <>
      <PageHeader eyebrow="ЦЕНТР УВЕДОМЛЕНИЙ" title="Уведомления" subtitle="Новости о статусах твоих публикаций и действиях модерации." action={<button className="icon-button" onClick={()=>loadMe().catch(e=>notify(e.message))}><RefreshCw size={17}/></button>}/>
      {!initData ? <TelegramGate/> : <div className="notifications-page"><div className="notes-list">{unreadNotes.length ? unreadNotes.map((note,index)=><div className="note-card" key={`${note.at}-${index}`}><Bell size={16}/><div><b>{note.title}</b><p>{note.body}</p><small>{note.at ? new Date(note.at).toLocaleString('ru-RU') : ''}</small></div></div>) : <EmptyState text="Новых уведомлений пока нет."/>}</div><button className="secondary-button full" onClick={async()=>{try{await api('notes_read');await loadMe();notify('Уведомления отмечены прочитанными');}catch(e){notify(e.message);}}}>Отметить прочитанными</button></div>}
    </>
  );

  const renderAdmin = () => (
    <>
      <PageHeader eyebrow="УПРАВЛЕНИЕ ПЛАТФОРМОЙ" title="Панель модерации" subtitle="Модерация заявок, контроль публикаций и статистика." action={<button className="icon-button" onClick={()=>loadAdmin().catch(e=>notify(e.message))}><RefreshCw size={17}/></button>}/>
      {!initData ? <TelegramGate/> : !isStaff ? <EmptyState text="У этой учётной записи нет доступа к панели модерации."/> : <div className="admin-page">
        <div className="metric-grid admin-metrics">{[['Пользователи',stats?.users],['Онлайн 24 ч.',stats?.active24h],['На модерации',stats?.pending],['Голосов',stats?.votes]].map(([label,value])=><div className="admin-stat" key={label}><b>{fmt(value)}</b><small>{label}</small></div>)}</div>
        <div className="section-head"><h3>Очередь модерации</h3><button className="text-action" onClick={()=>loadAdmin()}>Обновить</button></div>
        {queue.length?queue.map(item=><div className="queue-item" key={item.id}><b>{item.title}</b><small>@{item.username} · {item.category} · {item.owner}</small><p>{item.description}</p><div className="queue-actions">{canModerate && <><button className="approve-button" onClick={()=>moderate(item,'approved')}><Check size={15}/> Одобрить</button><button className="reject-button" onClick={()=>{setRejecting(item);setRejectReason('');}}><X size={15}/> Отклонить</button></>}</div></div>):<EmptyState text="Очередь модерации пуста."/>}
        <div className="section-head"><h3>Публикации</h3><button className="text-action" onClick={()=>setShowDeleted(!showDeleted)}>{showDeleted?'Активные':'Удалённые'}</button></div>
        {canManage && adminItems.map(item=><div className="my-pub" key={item.id}><div><b>{item.title}</b><small>@{item.username} · {item.status}</small></div>{showDeleted?<button className="icon-button" onClick={()=>adminRestore(item)}><RefreshCw size={16}/></button>:<button className="icon-button danger" onClick={()=>adminDelete(item)}><Trash2 size={16}/></button>}</div>)}
      </div>}
    </>
  );

  const body = tab === 'home' ? renderHome() : tab === 'catalog' ? renderCatalog() : tab === 'favorites' ? renderFavorites() : tab === 'add' ? renderAdd() : tab === 'rating' ? renderRating() : tab === 'notifications' ? renderNotifications() : tab === 'admin' ? renderAdmin() : renderProfile();

  return (
    <div className="app-shell">
      <header className="topbar"><button className="brand" onClick={()=>setTab('home')}><span className="brand-mark"><Grid2X2 size={19}/></span><span>Tendor<span>X</span><small>TELEGRAM DISCOVERY</small></span></button><div className="topbar-actions"><button className="icon-button" onClick={()=>setSearchOpen(!searchOpen)} aria-label="Поиск"><Search size={18}/></button><button className="icon-button" onClick={()=>setTab('profile')} aria-label="Профиль"><Users size={18}/></button><button className="menu-button" onClick={()=>setMobileMenu(!mobileMenu)}><Menu size={20}/></button></div></header>
      {searchOpen && <div className="global-search"><Search size={18}/><input autoFocus value={query} onChange={(e)=>setQuery(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter'){setTab('catalog');loadPublic({query:e.target.value});setSearchOpen(false);}}} placeholder="Найти сообщество…"/><button onClick={()=>setSearchOpen(false)}><X size={17}/></button></div>}
      <main className="main-content">
        {error && <div className="error-banner"><span>{error}</span><button onClick={()=>refresh()}><RefreshCw size={15}/> Повторить</button></div>}
        {loading ? <div className="loading-state"><LoaderCircle className="spin" size={28}/><span>Загружаем TendorX…</span></div> : body}
      </main>
      <nav className={`bottom-nav ${mobileMenu?'nav-open':''}`}>{nav.map(([id,Icon,label])=><button key={id} className={`${tab===id?'active':''} ${id==='add'?'add-nav':''}`} onClick={()=>{setTab(id);setMobileMenu(false);}}><span><Icon size={id==='add'?22:19}/></span><small>{label}</small></button>)}</nav>
      {toast && <div className="toast-message">{toast}</div>}
      {refreshing && <div className="refresh-indicator"><LoaderCircle className="spin" size={15}/> Обновляем данные</div>}
      {details && <div className="modal-backdrop" onClick={()=>setDetails(null)}><section className="detail-modal" onClick={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setDetails(null)}><X size={18}/></button><div className="detail-avatar">{avatarUrl(details)?<img src={avatarUrl(details)} alt=""/>:(details.title||'?').slice(0,1)}</div><div className="eyebrow">{details.category || categoryLabel(details.category_id)}</div><h2>{details.title}</h2><p className="detail-username">@{details.username}</p><p>{details.description || 'Описание не добавлено.'}</p><div className="detail-stats"><Metric icon={Trophy} value={fmt(details.rank)} label="Место"/><Metric icon={ThumbsUp} value={fmt(details.votes)} label="Голоса"/><Metric icon={Flame} value={`+${fmt(details.growth)}`} label="За неделю"/></div><div className="detail-actions"><button className="primary-button" onClick={()=>changeVote(details.id)}>{votedIds.has(Number(details.id))?'Отменить голос':'Проголосовать'}</button><button className="secondary-button" onClick={()=>openTelegram(details.username)}>Открыть в Telegram <ExternalLink size={15}/></button></div></section></div>}
      {rejecting && <div className="modal-backdrop" onClick={()=>setRejecting(null)}><section className="confirm-modal" onClick={(e)=>e.stopPropagation()}><button className="modal-close" onClick={()=>setRejecting(null)}><X size={18}/></button><h2>Отклонить публикацию</h2><p>{rejecting.title}</p><label>Причина (минимум 3 символа)</label><textarea rows={3} value={rejectReason} onChange={(e)=>setRejectReason(e.target.value)} placeholder="Укажи причину отказа"/><button className="reject-button full" disabled={rejectReason.trim().length<3} onClick={()=>moderate(rejecting,'rejected',rejectReason)}>Подтвердить отклонение</button></section></div>}
      <footer className="footer-note">TendorX · Каталог Telegram-сообществ</footer>
    </div>
  );
}

function EmptyState({ text }) { return <div className="empty-state"><span><Search size={22}/></span><p>{text}</p></div>; }
function Metric({ icon: Icon, value, label }) { return <div className="metric"><span><Icon size={16}/></span><b>{value}</b><small>{label}</small></div>; }
function TelegramGate() { return <div className="telegram-gate"><span><LogIn size={25}/></span><h3>Открой TendorX в Telegram</h3><p>Для голосования, избранного, публикаций и профиля нужна подтверждённая авторизация Telegram.</p><a href="https://t.me/TendorX" target="_blank" rel="noreferrer">Перейти к боту <ArrowRight size={15}/></a></div>; }