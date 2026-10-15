import { useEffect, useRef, useState, type FormEvent, type ReactNode, type ChangeEvent } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  Activity, ArrowRight, Bell, Camera, Check, ChevronRight, Compass, Heart,
  ImagePlus, LockKeyhole, LogOut, MessageCircle, MessageSquare, Pencil, Plus,
  Search, Send, Sparkles, UserRound, Users, X,
} from 'lucide-react';
import {
  getGetConversationsQueryKey, getGetFollowRequestsQueryKey, getGetMyProfileQueryKey,
  getGetNotificationsQueryKey, getGetPostCommentsQueryKey, getGetProfileQueryKey,
  getGetProfilePostsQueryKey, getListMessagesQueryKey, getSearchSocialQueryKey, useCreateComment, useCreatePost,
  useDeletePost, useGetConversations, useGetFeed, useGetMyProfile, useGetNotifications,
  useGetFollowRequests, useGetPostComments, useGetProfile, useGetProfilePosts,
  useHealthCheck, useListMessages, useMarkAllNotificationsRead, useRequestUploadUrl, useResolveFollowRequest, useSaveMyProfile,
  useSearchSocial, useSendMessage, useStartConversation, useToggleFollow, useToggleLike,
  useUpdatePost,
} from '@workspace/api-client-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = (error as { status?: number } | null)?.status;
        if (status !== undefined && status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: true,
      staleTime: 12_000,
    },
  },
});

function errorMessage(cause: unknown, fallback: string) {
  const data = (cause as { data?: { error?: unknown } } | null)?.data;
  if (data && typeof data.error === 'string' && data.error.trim()) return data.error;
  return fallback;
}
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

function mediaUrl(path?: string | null) {
  if (!path) return undefined;
  return path.startsWith('/objects/') ? `${basePath}/api/storage${path}` : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#2d685f', colorForeground: '#24313b', colorMutedForeground: '#71808a',
    colorDanger: '#b84943', colorBackground: '#fffdf8', colorInput: '#fffdf8',
    colorInputForeground: '#24313b', colorNeutral: '#ded8cb', fontFamily: 'DM Sans, sans-serif',
    borderRadius: '0.8rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fffdf8] rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'font-semibold tracking-tight', headerSubtitle: 'text-muted-foreground',
    socialButtonsBlockButton: 'rounded-xl border-border', formButtonPrimary: 'rounded-xl',
    formFieldInput: 'rounded-xl', footerActionLink: 'font-semibold',
  },
};

function Brand() {
  return <span className="brand" aria-label="Social Pulse"><span className="brand-mark" aria-hidden="true">s.</span>social pulse</span>;
}

function ClerkCacheReset() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const id = user?.id ?? null;
      if (previous.current !== undefined && previous.current !== id) client.clear();
      previous.current = id;
    });
    return unsubscribe;
  }, [addListener, client]);
  return null;
}

function AuthRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    localization={{
      signIn: { start: { title: 'Welcome back', subtitle: 'Pick up where your people left off.' } },
      signUp: { start: { title: 'Find your people', subtitle: 'A more personal corner of the internet.' } },
    }}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
  >
    <ClerkCacheReset />
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/profile-setup"><PrivateGate profileRequired={false}><ProfileSetup /></PrivateGate></Route>
      <Route path="/feed"><PrivateGate><FeedPage /></PrivateGate></Route>
      <Route path="/search"><PrivateGate><SearchPage /></PrivateGate></Route>
      <Route path="/profile/:username">{(params) => <PrivateGate><ProfilePage username={params.username} /></PrivateGate>}</Route>
      <Route path="/messages"><PrivateGate><MessagesPage /></PrivateGate></Route>
      <Route path="/notifications"><PrivateGate><NotificationsPage /></PrivateGate></Route>
      <Route><NotFound /></Route>
    </Switch>
  </ClerkProvider>;
}

function HomeRedirect() {
  return <>
    <Show when="signed-in"><Redirect to="/feed" /></Show>
    <Show when="signed-out"><Landing /></Show>
  </>;
}

function SignInPage() {
  return <div className="auth-wrap"><Link href="/" className="auth-brand"><Brand /></Link><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}
function SignUpPage() {
  return <div className="auth-wrap"><Link href="/" className="auth-brand"><Brand /></Link><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}

function PrivateGate({ children, profileRequired = true }: { children: ReactNode; profileRequired?: boolean }) {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded) return <LoadingScreen />;
  if (!isSignedIn) return <Redirect to="/" />;
  return <ProfileGate profileRequired={profileRequired}>{children}</ProfileGate>;
}
function ProfileGate({ children, profileRequired }: { children: ReactNode; profileRequired: boolean }) {
  const [location] = useLocation();
  const profile = useGetMyProfile({ query: { queryKey: getGetMyProfileQueryKey() } });
  const isSetup = location === '/profile-setup';
  if (profile.isLoading) return <LoadingScreen />;
  const noProfile = (profile.error as { status?: number } | null)?.status === 404;
  if (profile.isError && !noProfile) return <div className="page-wrap"><QueryError retry={() => profile.refetch()} /></div>;
  if (noProfile && profileRequired && !isSetup) return <Redirect to="/profile-setup" />;
  return <AppFrame>{children}</AppFrame>;
}

function AppFrame({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const profile = useGetMyProfile({ query: { queryKey: getGetMyProfileQueryKey() } });
  const { signOut } = useClerk();
  const links = [
    { href: '/feed', text: 'Feed', icon: Activity },
    { href: '/search', text: 'Explore', icon: Search },
    { href: '/messages', text: 'Messages', icon: MessageCircle },
    { href: '/notifications', text: 'Activity', icon: Bell },
  ];
  return <div className="page">
    <header className="app-topbar"><div className="app-topbar-inner">
      <Link href="/feed" className="brand"><span className="brand-mark">s.</span><span>social pulse</span></Link>
      <nav className="nav-links" aria-label="Main navigation">
        {links.map(({ href, text, icon: Icon }) => <Link href={href} key={href} className={`nav-link ${window.location.pathname.endsWith(href) ? 'active' : ''}`} data-testid={`link-nav-${text.toLowerCase()}`}><Icon size={17} /><span>{text}</span></Link>)}
        {profile.data && <Link href={`/profile/${profile.data.username}`} className="nav-link" data-testid="link-nav-profile"><UserRound size={17} /><span>Profile</span></Link>}
      </nav>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {profile.data?.avatarPath ? <img src={mediaUrl(profile.data.avatarPath)} alt="" className="avatar" data-testid="img-current-avatar" /> : <div className="avatar" aria-label="Your account">{(profile.data?.displayName || user?.firstName || 'S').slice(0, 1).toUpperCase()}</div>}
        <button className="icon-button" aria-label="Sign out" title="Sign out" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out"><LogOut size={18} /></button>
      </div>
    </div></header>
    <main>{children}</main>
  </div>;
}

function Landing() {
  return <div className="page">
    <header className="shell site-nav">
      <Brand />
      <div style={{ display: 'flex', gap: 8 }}>
        <Link href="/sign-in" className="button button-quiet" data-testid="link-sign-in">Sign in</Link>
        <Link href="/sign-up" className="button button-primary" data-testid="link-sign-up">Join Social Pulse <ArrowRight size={16} /></Link>
      </div>
    </header>
    <main className="shell">
      <section className="hero">
        <div className="rise">
          <div className="eyebrow">A little more human online</div>
          <h1>Keep the moments that <span>move you.</span></h1>
          <p className="hero-copy">A place for the photos you want to remember, the people you want to follow, and conversations that don’t disappear into the noise.</p>
          <div className="hero-actions">
            <Link href="/sign-up" className="button button-primary" data-testid="link-hero-join">Make your space <ArrowRight size={16} /></Link>
            <Link href="/sign-in" className="button" data-testid="link-hero-signin">I have an account</Link>
          </div>
        </div>
        <div className="visual-stage" aria-label="A warm, abstract landscape artwork">
          <div className="visual-card"><div className="visual-image" /></div>
        </div>
      </section>
      <section className="landing-section feature-row">
        <div>
          <div className="eyebrow">Your people, your pace</div>
          <h2>Less performing. More being there.</h2>
          <p>Follow the voices you care about, find new perspectives through discovery, and keep the exchange going in a real inbox.</p>
        </div>
        <div className="feature-tiles" aria-hidden="true"><div className="feature-tile" /><div className="feature-tile" /><div className="feature-tile" /><div className="feature-tile" /></div>
      </section>
      <section className="landing-section">
        <div className="eyebrow">The good stuff stays close</div>
        <h2>Photos with a person on the other side.</h2>
        <p>Share an image and a thought. Find a familiar name in your feed. Send a message, pick up tomorrow, and keep the conversation yours.</p>
        <Link href="/sign-up" className="button button-primary" style={{ marginTop: 14 }} data-testid="link-bottom-join">Start with your people <ArrowRight size={16} /></Link>
      </section>
    </main>
    <footer className="shell footer"><Brand /><span>A quieter kind of social.</span></footer>
  </div>;
}

function LoadingScreen() {
  return <div className="page-wrap" role="status" aria-label="Loading Social Pulse"><div className="skeleton" style={{ height: 34, width: 220, marginBottom: 25 }} /><div className="skeleton" style={{ height: 230, maxWidth: 670 }} /><span className="sr-only">Loading</span></div>;
}
function QueryError({ retry }: { retry: () => void }) {
  return <div className="panel empty-state" role="alert"><div className="empty-orbit"><Activity size={24} /></div><h2>That didn’t load.</h2><p>Check your connection and try again. Your account data hasn’t been changed.</p><button className="button" onClick={retry} data-testid="button-retry">Try again</button></div>;
}
function EmptyState({ icon = <Sparkles size={24} />, title, message, action }: { icon?: ReactNode; title: string; message: string; action?: ReactNode }) {
  return <div className="panel empty-state"><div className="empty-orbit">{icon}</div><h2>{title}</h2><p>{message}</p>{action}</div>;
}

function HealthBadge() {
  const health = useHealthCheck();
  return <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'hsl(var(--muted-foreground))' }} aria-live="polite" data-testid="status-service-health">
    <span style={{ width: 7, height: 7, borderRadius: '50%', background: health.isError ? 'hsl(var(--destructive))' : health.data ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }} />
    {health.isError ? 'Service connection unavailable' : health.data?.status || 'Connecting'}
  </div>;
}

function FeedPage() {
  const [scope, setScope] = useState<'following' | 'discover'>('following');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const client = useQueryClient();
  const onPostCreated = () => client.invalidateQueries({ queryKey: ['/api/feed'] });
  return <div className="page-wrap">
    <div className="page-heading"><div><div className="eyebrow">Your corner of the world</div><h1>Good to see you.</h1></div><HealthBadge /></div>
    <div className="feed-layout">
      <section>
        <div className="feed-tabs" role="tablist" aria-label="Feed view">
          <button className={`tab ${scope === 'following' ? 'active' : ''}`} onClick={() => { setScope('following'); setCursors([undefined]); }} role="tab" aria-selected={scope === 'following'} data-testid="tab-following">Following</button>
          <button className={`tab ${scope === 'discover' ? 'active' : ''}`} onClick={() => { setScope('discover'); setCursors([undefined]); }} role="tab" aria-selected={scope === 'discover'} data-testid="tab-discover">Discover</button>
        </div>
        <Composer onPublished={onPostCreated} />
        {cursors.map((cursor, index) => <FeedChunk
          key={`${scope}-${cursor ?? 'start'}`}
          scope={scope}
          cursor={cursor}
          isFirst={index === 0}
          isLast={index === cursors.length - 1}
          onLoadMore={(next) => setCursors((previous) => previous.includes(next) ? previous : [...previous, next])}
          onChanged={onPostCreated}
        />)}
      </section>
      <aside className="feed-aside">
        <div className="panel side-card" style={{ marginBottom: 14 }}><div className="eyebrow" style={{ marginBottom: 12 }}>A note to self</div><h3>It’s okay to keep it simple.</h3><p>A photo, a small detail, a hello to someone you miss. That’s enough to begin.</p></div>
        <div className="panel side-card"><h3>Make room for good conversations.</h3><p>Messages live in your inbox, ready when you are.</p><Link href="/messages" className="button button-quiet" style={{ marginTop: 12, paddingLeft: 0 }} data-testid="link-open-inbox">Open inbox <ChevronRight size={15} /></Link></div>
      </aside>
    </div>
  </div>;
}
function FeedChunk({ scope, cursor, isFirst, isLast, onLoadMore, onChanged }: {
  scope: 'following' | 'discover';
  cursor: string | undefined;
  isFirst: boolean;
  isLast: boolean;
  onLoadMore: (next: string) => void;
  onChanged: () => void;
}) {
  const feed = useGetFeed({ scope, ...(cursor ? { cursor } : {}), limit: 20 });
  const nextCursor = feed.data?.nextCursor;
  return <>
    {feed.isLoading && <FeedSkeleton />}
    {feed.isError && <QueryError retry={() => feed.refetch()} />}
    {isFirst && feed.data?.posts.length === 0 && <EmptyState icon={<Users size={24} />} title={scope === 'following' ? 'Your feed is ready for people.' : 'Nothing new to discover just yet.'} message={scope === 'following' ? 'Find a few people whose moments you want to keep up with.' : 'Check back later for new posts to explore.'} action={scope === 'following' ? <Link className="button button-primary" href="/search" data-testid="link-find-people">Find people</Link> : undefined} />}
    {feed.data?.posts.map((post) => <PostCard key={post.id} post={post} onChanged={onChanged} />)}
    {isLast && nextCursor && <button className="button" style={{ width: '100%' }} onClick={() => onLoadMore(nextCursor)} data-testid="button-load-more">Load more</button>}
  </>;
}

function FeedSkeleton() {
  return <div aria-label="Loading posts"><div className="panel" style={{ height: 430, marginBottom: 18, padding: 18 }}><div className="skeleton" style={{ height: 38, width: 170, marginBottom: 14 }} /><div className="skeleton" style={{ height: 285 }} /><div className="skeleton" style={{ height: 28, width: '65%', marginTop: 15 }} /></div></div>;
}

function Composer({ onPublished }: { onPublished: () => void }) {
  const profile = useGetMyProfile({ query: { queryKey: getGetMyProfileQueryKey() } });
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const createPost = useCreatePost();
  const requestUpload = useRequestUploadUrl();
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(selected.type)) {
      setError('Choose a JPEG, PNG, WebP, or GIF image.');
      event.target.value = '';
      return;
    }
    if (selected.size > 10 * 1024 * 1024) {
      setError('Images must be 10 MB or smaller.');
      event.target.value = '';
      return;
    }
    setError('');
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
  }
  async function publish() {
    if (!file) { setError('Choose an image to share.'); return; }
    setError('');
    setUploading(true);
    try {
      const signed = await requestUpload.mutateAsync({ data: { name: file.name, size: file.size, contentType: file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' } });
      const upload = await fetch(signed.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!upload.ok) throw new Error('The image could not be uploaded. Please try again.');
      await createPost.mutateAsync({ data: { caption: caption.trim(), mediaPath: signed.objectPath } });
      setCaption(''); setFile(null); setPreview('');
      if (fileInput.current) fileInput.current.value = '';
      onPublished();
    } catch (cause) {
      setError(errorMessage(cause, cause instanceof Error && cause.name !== 'ApiError' ? cause.message : 'Your post could not be published.'));
    } finally { setUploading(false); }
  }
  return <form className="panel composer" onSubmit={(event) => { event.preventDefault(); void publish(); }} data-testid="form-post-composer">
    <div className="composer-top">
      {profile.data?.avatarPath ? <img className="avatar" src={mediaUrl(profile.data.avatarPath)} alt="" /> : <div className="avatar">{profile.data?.displayName.slice(0, 1).toUpperCase() || 'S'}</div>}
      <textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={2200} placeholder="What’s worth remembering?" aria-label="Post caption" data-testid="input-post-caption" />
    </div>
    {preview && <div style={{ position: 'relative', margin: '8px 0 14px 54px', width: 'min(240px, 70%)' }}>
      <img src={preview} alt="Selected post preview" style={{ width: '100%', maxHeight: 250, objectFit: 'cover', borderRadius: 12 }} data-testid="img-post-preview" />
      <button type="button" className="icon-button" aria-label="Remove image" onClick={() => { setFile(null); setPreview(''); if (fileInput.current) fileInput.current.value = ''; }} style={{ position: 'absolute', top: 7, right: 7, background: 'hsl(var(--card))' }} data-testid="button-remove-image"><X size={16} /></button>
    </div>}
    <div className="composer-bottom">
      <div>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={chooseFile} hidden data-testid="input-post-image" />
        <button type="button" className="button button-quiet" onClick={() => fileInput.current?.click()} data-testid="button-add-image"><ImagePlus size={17} /> Add image</button>
      </div>
      <button type="submit" className="button button-primary" disabled={uploading || createPost.isPending || !file} data-testid="button-publish-post">{uploading ? 'Uploading…' : 'Share post'} <ArrowRight size={15} /></button>
    </div>
    {error && <div className="error-box" style={{ marginTop: 12 }} role="alert" data-testid="status-post-error">{error}</div>}
  </form>;
}

function PostCard({ post, onChanged }: { post: import('@workspace/api-client-react').Post; onChanged: () => void }) {
  const [showComments, setShowComments] = useState(false);
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(post.caption);
  const { user } = useUser();
  const like = useToggleLike();
  const update = useUpdatePost();
  const remove = useDeletePost();
  const client = useQueryClient();
  const ownPost = post.author.id === user?.id;
  const friendlyTime = timeAgo(post.createdAt);
  async function toggleLike() {
    await like.mutateAsync({ postId: post.id });
    onChanged();
  }
  async function saveCaption() {
    await update.mutateAsync({ postId: post.id, data: { caption } });
    setEditing(false); onChanged();
  }
  async function deletePost() {
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    await remove.mutateAsync({ postId: post.id });
    client.invalidateQueries({ queryKey: ['/api/feed'] });
  }
  return <article className="panel post rise" data-testid={`card-post-${post.id}`}>
    <div className="post-header">
      {post.author.avatarPath ? <img src={mediaUrl(post.author.avatarPath)} className="avatar" alt="" data-testid={`img-post-author-${post.id}`} /> : <div className="avatar">{post.author.displayName.slice(0, 1).toUpperCase()}</div>}
      <div style={{ minWidth: 0, flex: 1 }}>
        <Link href={`/profile/${post.author.username}`} className="post-author" data-testid={`link-post-author-${post.id}`}>{post.author.displayName}</Link>
        <div className="post-time">@{post.author.username} · {friendlyTime}</div>
      </div>
      {ownPost && <div style={{ display: 'flex', gap: 3 }}>
        <button className="icon-button" title="Edit caption" aria-label="Edit caption" onClick={() => setEditing(!editing)} data-testid={`button-edit-post-${post.id}`}><Pencil size={16} /></button>
        <button className="icon-button" title="Delete post" aria-label="Delete post" onClick={() => void deletePost()} disabled={remove.isPending} data-testid={`button-delete-post-${post.id}`}><X size={17} /></button>
      </div>}
    </div>
    {post.mediaPath && <img className="post-image" src={mediaUrl(post.mediaPath)} alt={post.caption || `Photo shared by ${post.author.displayName}`} data-testid={`img-post-${post.id}`} />}
    {editing ? <div style={{ padding: '12px 18px' }}><textarea className="textarea" value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={2200} aria-label="Edit post caption" data-testid={`input-edit-caption-${post.id}`} /><div style={{ display: 'flex', justifyContent: 'end', gap: 8, marginTop: 8 }}><button className="button" onClick={() => { setCaption(post.caption); setEditing(false); }} data-testid={`button-cancel-edit-${post.id}`}>Cancel</button><button className="button button-primary" onClick={() => void saveCaption()} disabled={update.isPending} data-testid={`button-save-edit-${post.id}`}>Save</button></div></div>
      : post.caption && <div className="post-caption" data-testid={`text-post-caption-${post.id}`}>{post.caption}</div>}
    <div className="post-actions">
      <button className="icon-button" style={{ color: post.likedByMe ? 'hsl(var(--accent))' : undefined }} aria-label={post.likedByMe ? 'Unlike post' : 'Like post'} aria-pressed={post.likedByMe} onClick={() => void toggleLike()} disabled={like.isPending} data-testid={`button-like-post-${post.id}`}><Heart size={19} fill={post.likedByMe ? 'currentColor' : 'none'} /></button>
      <span className="count" data-testid={`text-like-count-${post.id}`}>{post.likeCount}</span>
      <button className="icon-button" aria-label="View comments" onClick={() => setShowComments(!showComments)} data-testid={`button-comments-${post.id}`}><MessageSquare size={18} /></button>
      <button className="count" style={{ border: 0, padding: 0, background: 'transparent', cursor: 'pointer' }} onClick={() => setShowComments(!showComments)} data-testid={`text-comment-count-${post.id}`}>{post.commentCount} comments</button>
    </div>
    {showComments && <PostComments postId={post.id} onCreated={onChanged} />}
  </article>;
}

function PostComments({ postId, onCreated }: { postId: number; onCreated: () => void }) {
  const comments = useGetPostComments(postId, { query: { queryKey: getGetPostCommentsQueryKey(postId) } });
  const create = useCreateComment();
  const client = useQueryClient();
  const [text, setText] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    await create.mutateAsync({ postId, data: { text: value, parentCommentId: null } });
    setText('');
    await client.invalidateQueries({ queryKey: getGetPostCommentsQueryKey(postId) });
    onCreated();
  }
  return <section className="comments" aria-label="Post comments">
    {comments.isLoading && <div className="skeleton" style={{ height: 48 }} />}
    {comments.isError && <div className="muted" role="alert">Comments couldn’t load. Close and reopen to retry.</div>}
    {comments.data?.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Start the conversation.</div>}
    {comments.data?.map((comment) => <div className="comment-row" key={comment.id} data-testid={`text-comment-${comment.id}`}><strong>{comment.author.username}</strong> {comment.text}</div>)}
    <form className="comment-form" onSubmit={submit}>
      <input value={text} onChange={(event) => setText(event.target.value)} maxLength={1000} placeholder="Write a comment…" aria-label="Write a comment" data-testid={`input-comment-${postId}`} />
      <button className="button button-quiet" type="submit" disabled={!text.trim() || create.isPending} data-testid={`button-submit-comment-${postId}`}>Post</button>
    </form>
  </section>;
}

function SearchPage() {
  const [q, setQ] = useState('');
  const valid = q.trim().length >= 2;
  const results = useSearchSocial({ q: q.trim() }, { query: { enabled: valid, queryKey: getSearchSocialQueryKey({ q: q.trim() }), staleTime: 3000 } });
  return <div className="page-wrap">
    <div className="page-heading"><div><div className="eyebrow">Find your next favorite</div><h1>Explore.</h1></div></div>
    <div className="search-box"><Search size={18} /><input className="field" type="search" value={q} onChange={(event) => setQ(event.target.value)} minLength={2} maxLength={80} placeholder="Search people and posts" aria-label="Search people and posts" data-testid="input-social-search" /></div>
    {!valid && <div style={{ padding: '28px 4px' }}><div className="eyebrow">A good place to start</div><p className="muted">Search for a name, username, or something someone shared.</p></div>}
    {valid && results.isLoading && <div className="search-results"><div className="panel" style={{ padding: 20 }}><div className="skeleton" style={{ height: 160 }} /></div><div className="panel" style={{ padding: 20 }}><div className="skeleton" style={{ height: 160 }} /></div></div>}
    {valid && results.isError && <QueryError retry={() => results.refetch()} />}
    {valid && results.data && <div className="search-results">
      <section><div className="eyebrow">People</div>
        {results.data.profiles.length === 0 && <p className="muted">No matching profiles.</p>}
        {results.data.profiles.map((person) => <Link key={person.id} href={`/profile/${person.username}`} className="result-person" data-testid={`link-search-profile-${person.id}`}>
          {person.avatarPath ? <img src={mediaUrl(person.avatarPath)} className="avatar" alt="" /> : <div className="avatar">{person.displayName.slice(0, 1).toUpperCase()}</div>}
          <span><strong style={{ display: 'block' }}>{person.displayName}</strong><small className="muted">@{person.username}</small></span>
          <ChevronRight size={16} style={{ marginLeft: 'auto' }} />
        </Link>)}
      </section>
      <section><div className="eyebrow">Posts</div>
        {results.data.posts.length === 0 && <p className="muted">No matching posts.</p>}
        <div className="result-posts">{results.data.posts.map((post) => <Link key={post.id} href={`/profile/${post.author.username}`} className="result-post" aria-label={`Post by ${post.author.displayName}`} data-testid={`link-search-post-${post.id}`}>{post.mediaPath && <img src={mediaUrl(post.mediaPath)} alt={post.caption || 'Shared photo'} />}</Link>)}</div>
      </section>
    </div>}
  </div>;
}

function ProfilePage({ username }: { username: string }) {
  const profile = useGetProfile(username, { query: { queryKey: getGetProfileQueryKey(username) } });
  const ownProfile = useGetMyProfile({ query: { queryKey: getGetMyProfileQueryKey() } });
  const ownProfileView = ownProfile.data?.username === username;
  const profilePosts = useGetProfilePosts(username, { query: { queryKey: getGetProfilePostsQueryKey(username) } });
  const followRequests = useGetFollowRequests({ query: { enabled: ownProfileView, queryKey: getGetFollowRequestsQueryKey() } });
  const follow = useToggleFollow();
  const resolveRequest = useResolveFollowRequest();
  const start = useStartConversation();
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  async function toggleFollow() {
    try {
      const state = await follow.mutateAsync({ username });
      client.setQueryData(getGetProfileQueryKey(username), (old: typeof profile.data) => old ? { ...old, followedByMe: state.following, followPending: state.pending, followerCount: state.followerCount } : old);
    } catch { /* The mutation state below presents the retryable error. */ }
  }
  async function message() {
    try {
      const conversation = await start.mutateAsync({ data: { username } });
      await client.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
      setLocation(`/messages?conversation=${conversation.id}`);
    } catch { /* The mutation state below presents the error. */ }
  }
  async function respondToRequest(requestUsername: string, accepted: boolean) {
    try {
      await resolveRequest.mutateAsync({ username: requestUsername, data: { accepted } });
      await client.invalidateQueries({ queryKey: getGetFollowRequestsQueryKey() });
      await client.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
    } catch { /* The mutation state below presents the error. */ }
  }
  if (profile.isLoading) return <LoadingScreen />;
  if (profile.isError || !profile.data) return <div className="page-wrap"><QueryError retry={() => profile.refetch()} /></div>;
  const p = profile.data;
  return <div className="page-wrap">
    <div className="profile-head">
      {p.avatarPath ? <img className="avatar profile-avatar" src={mediaUrl(p.avatarPath)} alt={`${p.displayName}'s profile`} data-testid="img-profile-avatar" /> : <div className="avatar profile-avatar">{p.displayName.slice(0, 1).toUpperCase()}</div>}
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><h1 style={{ font: '800 32px var(--app-font-serif)', letterSpacing: '-.06em', margin: 0 }} data-testid="text-profile-display-name">{p.displayName}</h1>{p.isPrivate && <LockKeyhole size={17} aria-label="Private account" />}</div>
        <div className="muted" style={{ marginTop: 4 }} data-testid="text-profile-username">@{p.username}</div>
        <div className="profile-stats">
          <div className="profile-stat"><strong data-testid="text-profile-post-count">{p.postCount}</strong><span>posts</span></div>
          <div className="profile-stat"><strong data-testid="text-profile-follower-count">{p.followerCount}</strong><span>followers</span></div>
          <div className="profile-stat"><strong data-testid="text-profile-following-count">{p.followingCount}</strong><span>following</span></div>
        </div>
        <p style={{ maxWidth: 520, lineHeight: 1.55, whiteSpace: 'pre-wrap' }} data-testid="text-profile-bio">{p.bio}</p>
        {!ownProfileView && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className={`button ${p.followedByMe || p.followPending ? '' : 'button-primary'}`} onClick={() => void toggleFollow()} disabled={follow.isPending || p.followPending} data-testid="button-toggle-follow">{p.followPending ? <><Check size={16} /> Requested</> : p.followedByMe ? <><Check size={16} /> Following</> : <><Plus size={16} /> Follow</>}</button>
          <button className="button" onClick={() => void message()} disabled={start.isPending} data-testid="button-profile-message"><MessageCircle size={16} /> Message</button>
        </div>}
        {(follow.isError || start.isError) && <div className="error-box" style={{ marginTop: 10 }} role="alert">That action couldn’t be completed. Please try again.</div>}
      </div>
    </div>
    <div style={{ paddingTop: 28 }}>
      {ownProfileView && p.isPrivate && <section className="panel" style={{ padding: 20, marginBottom: 30 }} data-testid="section-follow-requests">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
          <div><div className="eyebrow">Your private space</div><h2 style={{ margin: '5px 0 0', font: '750 20px var(--app-font-serif)', letterSpacing: '-.04em' }}>Follow requests</h2></div>
          <span className="muted" style={{ fontSize: 13 }}>{followRequests.data?.length || 0} pending</span>
        </div>
        {followRequests.isLoading && <div className="skeleton" style={{ height: 62 }} />}
        {followRequests.isError && <QueryError retry={() => followRequests.refetch()} />}
        {!followRequests.isLoading && followRequests.data?.length === 0 && <p className="muted" style={{ marginBottom: 0, fontSize: 14 }}>No one is waiting for approval.</p>}
        {followRequests.data?.map((request) => <div key={request.id} className="notification-row" style={{ paddingInline: 0 }} data-testid={`row-follow-request-${request.id}`}>
          {request.avatarPath ? <img className="avatar" src={mediaUrl(request.avatarPath)} alt="" /> : <div className="avatar">{request.displayName.slice(0, 1).toUpperCase()}</div>}
          <div style={{ flex: 1, minWidth: 0 }}><strong>{request.displayName}</strong><div className="muted" style={{ fontSize: 12 }}>@{request.username} · {timeAgo(request.createdAt)}</div></div>
          <button className="button button-primary" style={{ minHeight: 36, paddingInline: 12 }} onClick={() => void respondToRequest(request.username, true)} disabled={resolveRequest.isPending} data-testid={`button-accept-follow-${request.id}`}>Accept</button>
          <button className="button" style={{ minHeight: 36, paddingInline: 12 }} onClick={() => void respondToRequest(request.username, false)} disabled={resolveRequest.isPending} data-testid={`button-decline-follow-${request.id}`}>Decline</button>
        </div>)}
        {resolveRequest.isError && <div className="error-box" style={{ marginTop: 12 }} role="alert">That request couldn’t be updated. Please try again.</div>}
      </section>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <div className="eyebrow">Photos and moments</div>
        <span className="muted" style={{ fontSize: 13 }}>{profilePosts.data?.length ?? p.postCount} posts</span>
      </div>
      {profilePosts.isLoading && <div className="profile-grid" aria-label="Loading profile posts">{[0, 1, 2].map((item) => <div className="skeleton" key={item} />)}</div>}
      {profilePosts.isError && <QueryError retry={() => profilePosts.refetch()} />}
      {profilePosts.data?.length === 0 && <EmptyState icon={<Camera size={24} />} title="No posts to see yet." message={ownProfileView ? 'When you share a photo, it will find a home here.' : 'There aren’t any visible posts here yet.'} action={ownProfileView ? <Link href="/feed" className="button button-primary" data-testid="link-profile-share-first">Share a photo</Link> : undefined} />}
      {profilePosts.data && profilePosts.data.length > 0 && <div className="profile-grid" data-testid="grid-profile-posts">
        {profilePosts.data.map((post) => <button key={post.id} type="button" className={`profile-post-tile ${selectedPostId === post.id ? 'selected' : ''}`} onClick={() => setSelectedPostId(selectedPostId === post.id ? null : post.id)} aria-label={`View post by ${post.author.displayName}: ${post.caption || 'photo'}`} aria-pressed={selectedPostId === post.id} data-testid={`button-profile-post-${post.id}`}>
          {post.mediaPath ? <img src={mediaUrl(post.mediaPath)} alt={post.caption || `Post by ${post.author.displayName}`} /> : <span>{post.caption || 'A shared moment'}</span>}
          {post.caption && <span className="profile-post-caption">{post.caption}</span>}
        </button>)}
      </div>}
      {selectedPostId !== null && profilePosts.data && (() => {
        const selectedPost = profilePosts.data.find((post) => post.id === selectedPostId);
        return selectedPost ? <div style={{ maxWidth: 640, margin: '18px auto 0' }}><PostCard post={selectedPost} onChanged={() => { void client.invalidateQueries({ queryKey: getGetProfilePostsQueryKey(username) }); }} /></div> : null;
      })()}
    </div>
  </div>;
}

function ProfileSetup() {
  const profile = useGetMyProfile({ query: { queryKey: getGetMyProfileQueryKey(), retry: false } });
  const save = useSaveMyProfile();
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState(profile.data?.username || '');
  const [displayName, setDisplayName] = useState(profile.data?.displayName || '');
  const [bio, setBio] = useState(profile.data?.bio || '');
  const [isPrivate, setPrivate] = useState(profile.data?.isPrivate || false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (profile.data) {
      setUsername(profile.data.username); setDisplayName(profile.data.displayName);
      setBio(profile.data.bio); setPrivate(profile.data.isPrivate);
    }
  }, [profile.data]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const saved = await save.mutateAsync({ data: { username: username.trim(), displayName: displayName.trim(), bio: bio.trim(), isPrivate } });
      await queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      setLocation(`/profile/${saved.username}`);
    } catch (cause) { setError(errorMessage(cause, 'We couldn’t save your profile. Try another username.')); }
  }
  return <div className="page-wrap" style={{ maxWidth: 660 }}>
    <div className="eyebrow">A good first hello</div><h1 style={{ font: '800 clamp(36px, 6vw, 52px) var(--app-font-serif)', letterSpacing: '-.07em', margin: '8px 0 10px' }}>{profile.data ? 'Your profile' : 'Make it yours.'}</h1>
    <p className="muted" style={{ marginBottom: 25 }}>Choose how you’d like people to know you. You can change these details any time.</p>
    <form className="panel form-card form-stack" onSubmit={submit} data-testid="form-profile-setup">
      <label><span className="form-label">Display name</span><input className="field" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={60} placeholder="How people know you" data-testid="input-profile-display-name" /></label>
      <label><span className="form-label">Username</span><div style={{ position: 'relative' }}><span style={{ position: 'absolute', left: 14, top: 12, color: 'hsl(var(--muted-foreground))' }}>@</span><input className="field" style={{ paddingLeft: 31 }} value={username} onChange={(event) => setUsername(event.target.value)} required minLength={3} maxLength={24} pattern="[a-zA-Z0-9_.]+" placeholder="your.name" data-testid="input-profile-username" /></div><small className="muted">3–24 letters, numbers, dots, or underscores.</small></label>
      <label><span className="form-label">A little about you</span><textarea className="textarea" value={bio} onChange={(event) => setBio(event.target.value)} maxLength={300} placeholder="What are you into?" data-testid="input-profile-bio" /></label>
      <label style={{ display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={isPrivate} onChange={(event) => setPrivate(event.target.checked)} data-testid="input-profile-private" /><span><strong style={{ fontSize: 14 }}>Private profile</strong><small className="muted" style={{ display: 'block' }}>You’ll approve people before they follow you.</small></span></label>
      {error && <div className="error-box" role="alert" data-testid="status-profile-error">{error}</div>}
      <button className="button button-primary" type="submit" disabled={save.isPending || !username.trim() || !displayName.trim()} data-testid="button-save-profile">{save.isPending ? 'Saving…' : profile.data ? 'Save profile' : 'Create profile'} <ArrowRight size={16} /></button>
    </form>
  </div>;
}

function MessagesPage() {
  const conversations = useGetConversations({ query: { queryKey: getGetConversationsQueryKey() } });
  const client = useQueryClient();
  const { user } = useUser();
  const [selectedId, setSelectedId] = useState<number | null>(() => Number(new URLSearchParams(window.location.search).get('conversation')) || null);
  const [username, setUsername] = useState('');
  const [startError, setStartError] = useState('');
  const start = useStartConversation();
  useEffect(() => {
    const stream = new EventSource('/api/conversations/events', { withCredentials: true });
    const refresh = () => {
      void client.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
      if (selectedId !== null) void client.invalidateQueries({ queryKey: getListMessagesQueryKey(selectedId) });
    };
    stream.onopen = refresh;
    stream.addEventListener('message', refresh);
    stream.addEventListener('notification', refresh);
    stream.onerror = () => { /* EventSource reconnects automatically; onopen rehydrates. */ };
    return () => {
      stream.removeEventListener('message', refresh);
      stream.removeEventListener('notification', refresh);
      stream.close();
    };
  }, [client, selectedId]);
  const selected = conversations.data?.find((item) => item.id === selectedId) || null;
  async function startChat(event: FormEvent) {
    event.preventDefault();
    setStartError('');
    try {
      const conversation = await start.mutateAsync({ data: { username: username.trim() } });
      setSelectedId(conversation.id); setUsername('');
      await client.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
    } catch (cause) { setStartError(errorMessage(cause, 'We couldn’t start that conversation.')); }
  }
  return <div className="page-wrap">
    <div className="page-heading"><div><div className="eyebrow">Keep the conversation going</div><h1>Messages.</h1></div></div>
    {conversations.isLoading && <div className="panel" style={{ padding: 20 }}><div className="skeleton" style={{ height: 400 }} /></div>}
    {conversations.isError && <QueryError retry={() => conversations.refetch()} />}
    {!conversations.isLoading && !conversations.isError && <div className="panel message-layout">
      <aside className="conversation-list">
        <div className="conversation-title"><strong>Inbox</strong><span className="eyebrow">{conversations.data?.length || 0}</span></div>
        <form onSubmit={startChat} style={{ padding: '0 14px 15px' }}>
          <label className="eyebrow" htmlFor="start-chat">New conversation</label>
          <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
            <input id="start-chat" className="field" style={{ padding: '9px 10px', fontSize: 13 }} value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={24} placeholder="@username" data-testid="input-new-conversation" />
            <button className="button button-primary" style={{ minHeight: 38, padding: '0 11px' }} type="submit" disabled={username.trim().length < 3 || start.isPending} aria-label="Start conversation" data-testid="button-start-conversation"><Plus size={17} /></button>
          </div>
          {startError && <div className="muted" role="alert" style={{ fontSize: 12, marginTop: 7 }}>{startError}</div>}
        </form>
        {conversations.data?.length === 0 && <div className="muted" style={{ padding: '12px 18px', fontSize: 13 }}>No conversations yet. Start one by username above.</div>}
        {conversations.data?.map((conversation) => <button key={conversation.id} className={`conversation-row ${conversation.id === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(conversation.id)} data-testid={`button-conversation-${conversation.id}`}>
          {conversation.otherUser.avatarPath ? <img src={mediaUrl(conversation.otherUser.avatarPath)} className="avatar" alt="" /> : <div className="avatar">{conversation.otherUser.displayName.slice(0, 1).toUpperCase()}</div>}
          <span style={{ minWidth: 0, flex: 1 }}><strong style={{ display: 'block', fontSize: 14 }}>{conversation.otherUser.displayName}</strong><small className="muted" style={{ display: 'block', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{conversation.lastMessage || `@${conversation.otherUser.username}`}</small></span>
          {conversation.unreadCount > 0 && <span style={{ minWidth: 20, height: 20, display: 'grid', placeItems: 'center', borderRadius: 99, background: 'hsl(var(--primary))', color: 'white', fontSize: 11 }}>{conversation.unreadCount}</span>}
        </button>)}
      </aside>
      <section className="conversation-detail">
        {selected ? <ConversationThread conversationId={selected.id} otherUser={selected.otherUser} myUserId={user?.id || ''} /> : <div className="empty-state" style={{ margin: 'auto' }}><div className="empty-orbit"><MessageCircle size={24} /></div><h2>Choose a conversation.</h2><p>Or start a new one with someone’s username.</p></div>}
      </section>
    </div>}
  </div>;
}
function ConversationThread({ conversationId, otherUser, myUserId }: { conversationId: number; otherUser: import('@workspace/api-client-react').PostAuthor; myUserId: string }) {
  const messages = useListMessages(conversationId, { query: { queryKey: getListMessagesQueryKey(conversationId) } });
  const send = useSendMessage();
  const client = useQueryClient();
  const [text, setText] = useState('');
  const scrollAnchor = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages.data?.length]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    const value = text.trim();
    setText('');
    try {
      await send.mutateAsync({ conversationId, data: { text: value } });
      await client.invalidateQueries({ queryKey: getListMessagesQueryKey(conversationId) });
      await client.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
    } catch { setText(value); }
  }
  return <>
    <div style={{ padding: 17, borderBottom: '1px solid hsl(var(--border))', display: 'flex', alignItems: 'center', gap: 11 }}>
      {otherUser.avatarPath ? <img src={mediaUrl(otherUser.avatarPath)} className="avatar" alt="" /> : <div className="avatar">{otherUser.displayName.slice(0, 1).toUpperCase()}</div>}
      <div><strong>{otherUser.displayName}</strong><div className="muted" style={{ fontSize: 12 }}>@{otherUser.username}</div></div>
    </div>
    <div className="messages-scroll" role="log" aria-label={`Messages with ${otherUser.displayName}`} data-testid="list-messages">
      {messages.isLoading && <div className="skeleton" style={{ height: 180 }} />}
      {messages.isError && <button className="button" onClick={() => messages.refetch()} data-testid="button-retry-messages">Retry loading messages</button>}
      {messages.data?.length === 0 && <p className="muted" style={{ textAlign: 'center', margin: 'auto' }}>Say hello when you’re ready.</p>}
      {messages.data?.map((message) => <div key={message.id} className={`message-bubble ${message.sender.id === myUserId ? 'mine' : ''}`} data-testid={`text-message-${message.id}`}>{message.text}<div style={{ fontSize: 10, opacity: .68, marginTop: 5 }}>{timeAgo(message.createdAt)}</div></div>)}
      <div ref={scrollAnchor} />
    </div>
    <form className="message-compose" onSubmit={submit}>
      <input className="field" value={text} onChange={(event) => setText(event.target.value)} maxLength={5000} placeholder="Write a message…" aria-label="Write a message" data-testid="input-message-text" />
      <button className="button button-primary" type="submit" disabled={!text.trim() || send.isPending} aria-label="Send message" data-testid="button-send-message"><Send size={17} /></button>
    </form>
    {send.isError && <div className="error-box" style={{ margin: '0 16px 16px' }} role="alert">Your message wasn’t sent. Please try again.</div>}
  </>;
}

function NotificationsPage() {
  const notifications = useGetNotifications({ query: { queryKey: getGetNotificationsQueryKey() } });
  const markRead = useMarkAllNotificationsRead();
  const client = useQueryClient();
  async function readAll() {
    await markRead.mutateAsync();
    await client.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
  }
  const unread = notifications.data?.some((note) => !note.readAt);
  return <div className="page-wrap" style={{ maxWidth: 770 }}>
    <div className="page-heading"><div><div className="eyebrow">Things happening around you</div><h1>Activity.</h1></div>{unread && <button className="button" onClick={() => void readAll()} disabled={markRead.isPending} data-testid="button-mark-all-read">{markRead.isPending ? 'Saving…' : 'Mark all read'}</button>}</div>
    {notifications.isLoading && <div className="panel" style={{ padding: 20 }}><div className="skeleton" style={{ height: 300 }} /></div>}
    {notifications.isError && <QueryError retry={() => notifications.refetch()} />}
    {notifications.data?.length === 0 && <EmptyState icon={<Bell size={23} />} title="All caught up." message="When someone follows, likes, comments, or messages you, you’ll find it here." />}
    {notifications.data?.length ? <div className="panel">
      {notifications.data.map((note) => <div key={note.id} className={`notification-row ${note.readAt ? '' : 'notification-unread'}`} data-testid={`row-notification-${note.id}`}>
        {note.actor.avatarPath ? <img src={mediaUrl(note.actor.avatarPath)} className="avatar" alt="" /> : <div className="avatar">{note.actor.displayName.slice(0, 1).toUpperCase()}</div>}
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ lineHeight: 1.5 }}><strong>{note.actor.displayName}</strong> {note.text}</div><small className="muted">{timeAgo(note.createdAt)}</small></div>
        {!note.readAt && <span aria-label="Unread" style={{ width: 8, height: 8, borderRadius: 9, background: 'hsl(var(--accent))' }} />}
      </div>)}
    </div> : null}
  </div>;
}

function NotFound() {
  return <div className="page-wrap" style={{ maxWidth: 540, paddingTop: 70 }}><EmptyState icon={<Search size={23} />} title="This page wandered off." message="That address doesn’t lead anywhere we can find." action={<Link className="button button-primary" href="/" data-testid="link-not-found-home">Back to the beginning</Link>} /></div>;
}

function timeAgo(value: string) {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function App() {
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in environment.');
  return <QueryClientProvider client={queryClient}>
    <WouterRouter base={basePath}>
      <AuthRoutes />
    </WouterRouter>
  </QueryClientProvider>;
}

export default App;
