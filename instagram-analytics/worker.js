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
 * Endpoint:  GET /?username=natgeo
 * Returns:   JSON with profile data + recent posts (paginated, up to ~100)
 */

const ALLOWED_ORIGINS = ['*']; // tighten to your domain in production
const MEDIA_QUERY_HASH = 'e769aa130647d2571c27c44596cb68bd';

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
    const username = (url.searchParams.get('username') || '').replace(/^@/, '').trim().toLowerCase();

    if (!username || !/^[a-z0-9._]{1,30}$/.test(username)) {
      return json({ error: 'Invalid or missing username parameter.' }, 400, request);
    }

    // Try multiple Instagram endpoints in order
    const strategies = [
      () => fetchWebProfileInfo(username),
      () => fetchProfilePage(username),
    ];

    let lastError = 'All strategies failed.';
    for (const strategy of strategies) {
      try {
        const data = await strategy();
        if (data?.profile?.username) {
          // Paginate for more posts if possible
          if (data._userId && data._pageInfo?.has_next_page) {
            await paginatePosts(data);
          }
          // Clean internal fields before returning
          delete data._userId;
          delete data._pageInfo;
          return json(data, 200, request);
        }
      } catch (e) {
        lastError = e.message || String(e);
      }
    }

    return json({ error: lastError }, 502, request);
  },
};

// ── Pagination via GraphQL ──────────────────────────────
async function paginatePosts(data) {
  let cursor = data._pageInfo?.end_cursor;
  let hasNext = data._pageInfo?.has_next_page;
  const userId = data._userId;

  while (hasNext && cursor) {
    try {
      const variables = JSON.stringify({
        id: userId,
        first: 50,
        after: cursor,
      });
      const gqlUrl = `https://www.instagram.com/graphql/query/?query_hash=${MEDIA_QUERY_HASH}&variables=${encodeURIComponent(variables)}`;
      const res = await fetch(gqlUrl, { headers: IG_HEADERS });
      if (!res.ok) break;

      const body = await res.json();
      const media = body?.data?.user?.edge_owner_to_timeline_media;
      if (!media) break;

      const newPosts = (media.edges ?? []).map(({ node: p }) => parsePost(p));
      data.posts.push(...newPosts);

      hasNext = media.page_info?.has_next_page ?? false;
      cursor  = media.page_info?.end_cursor ?? null;
    } catch {
      break; // stop on any error, return what we have
    }
  }
}

// ── Strategy 1: web_profile_info API ────────────────────
async function fetchWebProfileInfo(username) {
  const res = await fetch(
    `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    { headers: IG_HEADERS }
  );

  if (!res.ok) throw new Error(`web_profile_info returned ${res.status}`);

  const body = await res.json();
  const user = body?.data?.user;
  if (!user) throw new Error('No user in web_profile_info response');

  return parseUser(user);
}

// ── Strategy 2: Public profile page HTML ────────────────
async function fetchProfilePage(username) {
  const res = await fetch(`https://www.instagram.com/${encodeURIComponent(username)}/?__a=1&__d=dis`, {
    headers: {
      ...IG_HEADERS,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!res.ok) throw new Error(`Profile page returned ${res.status}`);

  const body = await res.json();
  const user = body?.graphql?.user || body?.data?.user;
  if (!user) throw new Error('Could not parse profile page JSON');

  return parseUser(user);
}

// ── Parse single post node ──────────────────────────────
function parsePost(p) {
  const cap = p.edge_media_to_caption?.edges?.[0]?.node?.text ?? '';
  return {
    shortcode:  p.shortcode,
    url:        `https://www.instagram.com/p/${p.shortcode}/`,
    caption:    cap,
    timestamp:  p.taken_at_timestamp ?? 0,
    type:       p.__typename === 'GraphVideo'   ? 'reel'
              : p.__typename === 'GraphSidecar' ? 'carousel'
              : 'image',
    thumbnail:  p.thumbnail_src ?? p.display_url ?? '',
    likes:      p.edge_media_preview_like?.count ?? p.edge_liked_by?.count ?? p.like_count ?? 0,
    comments:   p.edge_media_to_comment?.count ?? p.comment_count ?? 0,
    plays:      p.video_view_count ?? 0,
    isVideo:    p.is_video ?? false,
  };
}

// ── Parse Instagram user object ─────────────────────────
function parseUser(user) {
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

  const edges = media?.edges ?? [];
  const posts = edges.map(({ node: p }) => parsePost(p));

  return {
    profile,
    posts,
    // Internal: used for pagination, stripped before response
    _userId:   user.id ?? user.pk ?? null,
    _pageInfo: media?.page_info ?? null,
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
