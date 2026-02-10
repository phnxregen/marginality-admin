# Marginality Admin Setup Guide

This guide covers setting up the Marginality Admin UI for managing YouTube channels and video imports.

## Architecture Overview

- **Admin UI**: Remix app deployed on Netlify
- **Authentication**: Supabase Auth (email/password)
- **Database**: Supabase PostgreSQL
- **Edge Functions**: Supabase Edge Functions for privileged operations
- **Security**: Admin-only access via `admin_users` allowlist table

### Security Model

- Admin UI NEVER uses Supabase service role key
- Admin UI NEVER inserts channels/videos directly
- All DB writes go through Edge Functions that:
  1. Verify admin status via JWT + `admin_users` table
  2. Use service role key internally for DB writes
  3. RLS policies block all client-side inserts

## Prerequisites

1. Supabase project with:
   - `external_channels` table
   - `videos` table
   - YouTube Data API v3 key

2. Netlify account

3. Node.js 20+ installed locally

## Step 1: Supabase Database Setup

### 1.1 Run Migrations

Apply the migrations in `supabase/migrations/`:

```bash
# Using Supabase CLI
supabase db push

# Or manually in Supabase SQL Editor:
# - 20250225000000_admin_setup.sql
```

This creates:
- `admin_users` allowlist table
- RLS policies blocking client inserts on `external_channels` and `videos`
- Read policies for authenticated users

### 1.2 Create First Admin User

1. Sign up for an account in the admin UI (or use Supabase Auth directly)
2. Note the user's UUID from `auth.users` table
3. Insert into `admin_users`:

```sql
INSERT INTO public.admin_users (user_id)
VALUES ('<user-uuid-from-auth.users>');
```

To find your user UUID:
```sql
SELECT id, email FROM auth.users WHERE email = 'your-email@example.com';
```

## Step 2: Supabase Edge Functions Setup

### 2.1 Set Function Secrets

Set required environment variables for Edge Functions:

```bash
# Using Supabase CLI
supabase secrets set SUPABASE_URL=https://your-project.supabase.co
supabase secrets set SUPABASE_ANON_KEY=your-anon-key
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
supabase secrets set YOUTUBE_API_KEY=your-youtube-api-key
```

These secrets are available to all Edge Functions via `Deno.env.get()`.

### 2.2 Deploy Edge Functions

```bash
# Deploy all functions
supabase functions deploy create_channel_admin
supabase functions deploy import_channel_videos_admin

# Or deploy from the project root
cd supabase/functions
supabase functions deploy create_channel_admin --project-ref your-project-ref
supabase functions deploy import_channel_videos_admin --project-ref your-project-ref
```

### 2.3 Verify Functions

Test via Supabase Dashboard → Edge Functions or via curl:

```bash
curl -X POST https://your-project.supabase.co/functions/v1/create_channel_admin \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"identifier": "UC..."}'
```

## Step 3: Netlify Deployment

### 3.1 Environment Variables

Set these in Netlify Dashboard → Site Settings → Environment Variables:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SESSION_SECRET=your-random-secret-string
```

**Important**: 
- Use `NEXT_PUBLIC_` prefix for client-accessible vars
- `SESSION_SECRET` should be a random string (e.g., `openssl rand -base64 32`)

### 3.2 Deploy

1. Connect your Git repository to Netlify
2. Build command: `npm run build`
3. Publish directory: `build/client`
4. Netlify will auto-deploy on push

Or deploy manually:

```bash
npm run build
netlify deploy --prod
```

### 3.3 Custom Domain (Optional)

To add `admin.marginality.app`:

1. In Netlify Dashboard → Domain settings
2. Add custom domain: `admin.marginality.app`
3. Configure DNS:
   - Add CNAME record: `admin` → `your-site.netlify.app`
   - Or use Netlify DNS
4. SSL certificate will auto-provision

## Step 4: Verify Setup

1. **Login**: Visit `/login` and sign in with your admin account
2. **Create Channel**: Go to `/channels/new` and add a YouTube channel
3. **Import Videos**: Go to channel detail page and click "Import Videos"

## Troubleshooting

### "User is not an admin" error

- Check `admin_users` table: `SELECT * FROM admin_users WHERE user_id = '<your-id>'`
- Verify you're using the correct user account

### Edge Function authentication fails

- Verify JWT token is valid: Check Supabase Dashboard → Auth → Users
- Check `Authorization: Bearer <token>` header format
- Ensure `SUPABASE_ANON_KEY` secret is set correctly

### YouTube API errors

- Verify `YOUTUBE_API_KEY` secret is set
- Check API quota in Google Cloud Console
- Ensure API is enabled: YouTube Data API v3

### RLS policy errors

- Verify migrations ran successfully
- Check policies: `SELECT * FROM pg_policies WHERE tablename IN ('external_channels', 'videos')`
- Ensure read policies allow authenticated users

### Database connection errors

- Verify `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Netlify
- Check Supabase project status
- Review Supabase logs for connection issues

## Schema Notes

If your `external_channels` or `videos` schema differs from expectations, you may need to:

1. Adjust column names in Edge Functions (marked with `TODO:` comments)
2. Create mapping layer in functions
3. Update RLS policies to match your schema

Common schema variations:
- `thumbnail_url` column may be missing in `external_channels`
- Unique constraint on `videos` may be composite (`external_channel_id + youtube_video_id`)
- Column names may use snake_case vs camelCase

## Adding More Admins

To add additional admin users:

```sql
INSERT INTO public.admin_users (user_id)
SELECT id FROM auth.users WHERE email = 'new-admin@example.com';
```

## Development

### Local Development

```bash
# Install dependencies
npm install

# Run dev server
npm run dev

# Set local env vars in .env file:
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SESSION_SECRET=...
```

### Testing Edge Functions Locally

```bash
# Using Supabase CLI
supabase functions serve create_channel_admin --env-file .env.local

# Test with curl
curl -X POST http://localhost:54321/functions/v1/create_channel_admin \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"identifier": "UC..."}'
```

## Security Best Practices

1. **Never commit secrets**: Use environment variables
2. **Rotate secrets regularly**: Especially `SESSION_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`
3. **Minimize admin_users**: Only add trusted users
4. **Monitor Edge Function logs**: Check for unauthorized access attempts
5. **Use HTTPS**: Always use secure connections in production
6. **Review RLS policies**: Regularly audit database access policies

## Support

For issues or questions:
- Check Supabase logs: Dashboard → Edge Functions → Logs
- Check Netlify logs: Site → Functions → Logs
- Review browser console for client-side errors
