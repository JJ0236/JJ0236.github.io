/**
 * Instagram Profile Proxy — Cloudflare Worker
 *
 * Deploy to your Cloudflare account:
 *   1. Go to dash.cloudflare.com → Workers & Pages → Create
 *   2. Name it (e.g. "ig-proxy"), click Deploy
 *   3. Click "Edit Code" and paste this entire file
 *   4. Click Deploy
 *   5. Copy your worker URL (e.g. ig-proxy.your-domain.workers.dev)
 *   6. Paste it into the dashboard's WORKER_URL constant
 *
 * Endpoints:
 *   GET /?username=natgeo              → profile + first 12 posts + userId
 *   GET /?userId=123&max_id=abc        → next page of posts (v1 feed API)
 */

const ALLOWED_ORIGINS = ['*']; // tighten to your domain in production

const IG_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'X-IG-App-ID': '936619743392459',
  'X-Requested-With': 'XMLHttpRequest',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

export default {
  async fetch(request) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);

    // ── Mode 2: Paginate one page of posts ────────────────
    const userId = url.searchParams.get('userId');
    const maxId  = url.searchParams.get('max_id') || '';
    if (userId) {
      if (!/^\d{1,20}$/.test(userId)) {
        return json({ error: 'Invalid userId.' }, 400, request);
      }
      try {
        const page = await fetchOnePage(userId, maxId);
        return json(page, 200, request);
      } catch (e) {
        return json({ error: e.message || 'Pagination failed.' }, 502, request);
      }
    }

    // ── Mode 1: Profile + initial posts ───────────────────
    const username = (url.searchParams.get('username') || '').replace(/^@/, '').trim().toLowerCase();

    if (!username || !/^[a-z0-9._]{1,30}$/.test(username)) {
      return json({ error: 'Invalid or missing username parameter.' }, 400, request);
    }

    try {
      const data = await fetchProfile(username);
      if (!data?.profile?.username) {
        return json({ error: 'Could not load profile. Account may be private or not exist.' }, 404, request);
      }
      // Expose userId so client can paginate
      data.userId = data._userId || null;
      delete data._userId;
      return json(data, 200, request);
    } catch (e) {
      return json({ error: e.message || 'Request failed.' }, 502, request);
    }
  },
};

// ── Fetch profile + initial posts ───────────────────────
async function fetchProfile(username) {
  // Try web_profile_info first (returns GraphQL-shaped data)
  const strategies = [
    () => fetchWebProfileInfo(username),
    () => fetchProfilePage(username),
  ];

  for (const strategy of strategies) {
    try {
      const data = await strategy();
      if (data?.profile?.username) return data;
    } catch { /* try next */ }
  }
  throw new Error('All profile fetch strategies failed.');
}

async function fetchWebProfileInfo(username) {
  const res = await fetch(
    `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    { headers: IG_HEADERS }
  );
  if (!res.ok) throw new Error(`web_profile_info ${res.status}`);
  const body = await res.json();
  const user = body?.data?.user;
  if (!user) throw new Error('No user in response');
  return parseProfileUser(user);
}

async function fetchProfilePage(username) {
  const res = await fetch(
    `https://www.instagram.com/${encodeURIComponent(username)}/?__a=1&__d=dis`,
    { headers: { ...IG_HEADERS, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } }
  );
  if (!res.ok) throw new Error(`Profile page ${res.status}`);
  const body = await res.json();
  const user = body?.graphql?.user || body?.data?.user;
  if (!user) throw new Error('No user in page response');
  return parseProfileUser(user);
}

// ── Fetch one page of posts via v1 feed API ─────────────
async function fetchOnePage(userId, maxId) {
  let feedUrl = `https://i.instagram.com/api/v1/feed/user/${userId}/?count=33`;
  if (maxId) feedUrl += `&max_id=${encodeURIComponent(maxId)}`;

  const res = await fetch(feedUrl, { headers: IG_HEADERS });
  if (!res.ok) throw new Error(`Feed API returned ${res.status}`);

  const body = await res.json();
  const items = body.items || [];
  const posts = items.map(parseFeedItem).filter(Boolean);

  return {
    posts,
    more_available: !!body.more_available,
    next_max_id: body.next_max_id || null,
  };
}

// ── Parse profile user (GraphQL shape) ──────────────────
function parseProfileUser(user) {
  const media = user.edge_owner_to_timeline_media;

  const profile = {
    username:    user.username,
    fullName:    user.full_name || user.username,
    biography:   user.biography || '',
    followers:   user.edge_followed_by?.count ?? user.follower_count ?? 0,
    following:   user.edge_follow?.count ?? user.following_count ?? 0,
    totalPosts:  media?.count ?? user.media_count ?? 0,
    isVerified:  user.is_verified ?? false,
    isPrivate:   user.is_private ?? false,
    profilePic:  user.profile_pic_url_hd || user.profile_pic_url || '',
    externalUrl: user.external_url || '',
  };

  // Parse initial posts from GraphQL edges
  const edges = media?.edges ?? [];
  const posts = edges.map(({ node: p }) => parseGraphPost(p));

  return {
    profile,
    posts,
    _userId: user.id ?? user.pk ?? null,
  };
}

// ── Parse a GraphQL post node ───────────────────────────
function parseGraphPost(p) {
  const cap = p.edge_media_to_caption?.edges?.[0]?.node?.text ?? '';
  return {
    shortcode: p.shortcode,
    url:       `https://www.instagram.com/p/${p.shortcode}/`,
    caption:   cap,
    timestamp: p.taken_at_timestamp ?? 0,
    type:      p.__typename === 'GraphVideo'   ? 'reel'
             : p.__typename === 'GraphSidecar' ? 'carousel'
             : 'image',
    thumbnail: p.thumbnail_src ?? p.display_url ?? '',
    likes:     p.edge_media_preview_like?.count ?? p.edge_liked_by?.count ?? p.like_count ?? 0,
    comments:  p.edge_media_to_comment?.count ?? p.comment_count ?? 0,
    plays:     p.video_view_count ?? 0,
    isVideo:   p.is_video ?? false,
  };
}

// ── Parse a v1 feed item ────────────────────────────────
function parseFeedItem(item) {
  const code = item.code;
  if (!code) return null;

  const cap = item.caption?.text ?? '';
  // media_type: 1=image, 2=video, 8=carousel
  const mt = item.media_type;
  const type = mt === 2 ? 'reel'
             : mt === 8 ? 'carousel'
             : 'image';

  return {
    shortcode: code,
    url:       `https://www.instagram.com/p/${code}/`,
    caption:   cap,
    timestamp: item.taken_at ?? 0,
    type,
    thumbnail: item.image_versions2?.candidates?.[0]?.url ?? '',
    likes:     item.like_count ?? 0,
    comments:  item.comment_count ?? 0,
    plays:     item.play_count ?? item.view_count ?? 0,
    isVideo:   mt === 2,
  };
}

// ── Helpers ─────────────────────────────────────────────
function corsHeaders(request) {
  const origin = request?.headers?.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0] === '*' ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(request),
    },
  });
}
