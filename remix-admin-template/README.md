# Marginality Admin

Admin UI for managing YouTube channels and video imports for the Marginality project.

## Overview

The Marginality Admin is a Remix application deployed on Netlify that provides a secure interface for:

- Managing YouTube channels (create, view)
- Importing videos from YouTube channels
- Tracking video indexing status

## Architecture

- **Frontend**: Remix with Vite, Tailwind CSS
- **Backend**: Supabase (Auth + PostgreSQL)
- **Deployment**: Netlify
- **Security**: Admin-only access via Supabase Edge Functions + RLS policies

### Security Model

- Admin UI authenticates via Supabase Auth (email/password)
- All database writes go through Supabase Edge Functions
- Edge Functions verify admin status via `admin_users` allowlist table
- RLS policies block all client-side inserts into `external_channels` and `videos` tables

## Features

- ✅ Secure admin authentication (Supabase Auth)
- ✅ Protected routes with session management
- ✅ Channel management (create, list, view)
- ✅ YouTube video import via Edge Functions
- ✅ Video count tracking (total, unindexed)
- ✅ Responsive design with mobile navigation
- ✅ TypeScript for type safety

## Quick Start

### Prerequisites

- Node.js 20+
- Supabase project with `external_channels` and `videos` tables
- YouTube Data API v3 key
- Netlify account

### Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up Supabase**:
   - Run migrations from `supabase/migrations/`
   - Create first admin user (see [SETUP.md](./docs/admin/SETUP.md))
   - Deploy Edge Functions

3. **Configure environment variables** (see [SETUP.md](./docs/admin/SETUP.md))

4. **Deploy to Netlify**:
   - Connect repository
   - Set environment variables
   - Deploy

See [docs/admin/SETUP.md](./docs/admin/SETUP.md) for detailed setup instructions.

## Development

### Local Development

```bash
# Install dependencies
npm install

# Run dev server
npm run dev
```

Set environment variables in `.env`:
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SESSION_SECRET=...
```

### Build

```bash
npm run build
```

### Test

```bash
npm run typecheck
npm run lint
```

## Project Structure

```
remix-admin-template/
├── app/
│   ├── components/          # Reusable UI components
│   ├── lib/                 # Core libraries
│   │   ├── auth.server.ts   # Auth helpers
│   │   ├── supabase.client.ts
│   │   └── functions.client.ts
│   ├── routes/              # Remix routes
│   │   ├── login.tsx        # Login page
│   │   ├── channels.tsx     # Channels layout
│   │   ├── channels._index.tsx  # Channels list
│   │   ├── channels.new.tsx     # Create channel
│   │   └── channels.$id.tsx    # Channel detail + import
│   └── utils/               # Utility functions
├── supabase/
│   ├── functions/           # Supabase Edge Functions
│   │   ├── _shared/
│   │   │   └── admin_auth.ts
│   │   ├── create_channel_admin/
│   │   └── import_channel_videos_admin/
│   └── migrations/          # Database migrations
└── docs/
    └── admin/
        └── SETUP.md         # Setup guide
```

## API Routes

### Edge Functions

- `create_channel_admin`: Creates a new YouTube channel entry
  - Input: `{ identifier: string }` (channel ID, handle, or URL)
  - Output: `{ channel: {...} }`

- `import_channel_videos_admin`: Imports videos from a YouTube channel
  - Input: `{ externalChannelId: string, limit?: number }`
  - Output: `{ imported: number, updated: number, skipped: number, ... }`

### Pages

- `/login` - Admin login
- `/channels` - Channels list
- `/channels/new` - Create channel
- `/channels/:id` - Channel detail + import videos

## Environment Variables

### Netlify (Client)

- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key
- `SESSION_SECRET` - Random secret for session cookies

### Supabase Functions

- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (for DB writes)
- `YOUTUBE_API_KEY` - YouTube Data API v3 key

## Database Schema

### Tables

- `admin_users` - Allowlist of admin user IDs
- `external_channels` - YouTube channels
- `videos` - Imported videos

See migrations in `supabase/migrations/` for schema details.

## Security

- Admin-only access via `admin_users` table
- RLS policies block client-side inserts
- Edge Functions use service role key internally
- Secure session cookies (httpOnly, secure in production)

## Deployment

### Netlify

1. Connect Git repository
2. Build command: `npm run build`
3. Publish directory: `build/client`
4. Set environment variables
5. Deploy

See [SETUP.md](./docs/admin/SETUP.md) for detailed deployment instructions.

## Support

For setup issues, see [docs/admin/SETUP.md](./docs/admin/SETUP.md).

## License

See LICENSE file.
