# Gemini & Google Workspace Workshop — registration site

Students register, sign in and book one session for their college (400 seats each).
Postgraduates can also book one GRASAG session. Staff sign in on a separate link to see
registrations, download lists and manage staff roles.

- **Hosting:** Vercel (website + two small server functions)
- **Database & sign-in:** Supabase (PostgreSQL + Auth)

| Link | Who |
| --- | --- |
| `https://<your-site>.vercel.app/` | Students: register, sign in, choose a session |
| `https://<your-site>.vercel.app/staff` | Staff: super admins, organisers, college coordinators |

## What's in this folder

```
index.html            The whole website (student + staff screens)
api/config.js         Gives the browser the public Supabase settings
api/staff.js          Super-admin staff management (create / edit / remove staff)
supabase/schema.sql   Database tables, sessions, seat-limit rules and access rules
package.json          Tells Vercel to install the Supabase library for api/staff.js
vercel.json           Makes /staff open the staff portal
```

---

## Step 1: Set up Supabase (about 10 minutes)

1. Go to **supabase.com**, sign in and click **New project**. Pick a name, a strong database
   password and the region closest to Ghana (for example *West EU* or *South Africa*).
2. When the project is ready, open **SQL Editor → New query**, paste the whole of
   `supabase/schema.sql` and click **Run**. This creates the tables, the 28 sessions and the
   rules that stop a session going over 400 seats.
3. Open **Authentication → Sign In / Providers → Email** and check that Email is enabled.
   - **Confirm email:** turn this **off** so students can choose a session straight after
     registering. If you leave it on, every student must click a link in their inbox before signing in.
4. Open **Authentication → URL Configuration**:
   - **Site URL:** your Vercel address, e.g. `https://gemini-workshop.vercel.app`
     (you can come back and set this after Step 2).
   - **Redirect URLs:** add the same address.
5. **Email sending (important):** Supabase's built-in email is only meant for testing and
   sends very few emails per hour. Password-reset emails will stop arriving once lots of students use them.
   Go to **Authentication → Emails → SMTP Settings** and connect a real email service
   (for example Resend, Brevo or your institution's mail server).
6. Open **Project Settings → API** (or **API Keys**) and copy three values for Step 2:
   - **Project URL**
   - **anon / publishable** key (safe to use in the browser)
   - **service_role / secret** key (**keep private**; it only goes into Vercel)

## Step 2: Put the site on Vercel (about 10 minutes)

1. Create a new repository on **GitHub** and upload everything in this folder
   (keep the `api` and `supabase` folders as they are).
2. Go to **vercel.com → Add New → Project**, import that repository.
   Framework preset: **Other**. Leave the build settings empty.
3. Before deploying, open **Environment Variables** and add:

   | Name | Value |
   | --- | --- |
   | `SUPABASE_URL` | Project URL from Supabase |
   | `SUPABASE_ANON_KEY` | anon / publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key |

4. Click **Deploy**. When it finishes, copy your site address and put it into Supabase's
   **Site URL** and **Redirect URLs** (Step 1.4).

If you later change an environment variable, redeploy (Deployments → ⋯ → Redeploy).

## Step 3: Create your super admin account

1. In Supabase go to **Authentication → Users → Add user → Create new user**.
   Enter your email and a password, and tick **Auto Confirm User**.
2. In **SQL Editor**, run this with your own name and email:

   ```sql
   insert into public.staff (user_id, name, email, role)
   select id, 'Your Name', email, 'super' from auth.users where email = 'you@example.com';
   ```

3. Open `https://<your-site>.vercel.app/staff` and sign in. Under **Staff & roles** you can
   now add organisers and college coordinators. Each gets an email and password you choose.

## Roles

| Role | Can do |
| --- | --- |
| Super admin | Everything: all registrations, CSV downloads, session meeting links and sending them, add/edit/remove staff |
| Organiser | All registrations, CSV downloads, session meeting links and sending them |
| College coordinator | Registrations for their own college only |

The database enforces these rules, so a coordinator can never load another
college's students, even with technical tricks.

## How seats are protected

- Booking goes through a database function that locks the session while it counts seats.
  When the last seat goes, everyone else gets "That session has just filled up".
- A student can hold **one college session** and, if postgraduate, **one GRASAG session**.
  Clashing times are blocked.
- Students only see and can only book the sessions for their own college.

## Getting ready for heavy traffic (do this before you share the link)

Vercel and Supabase spread the load automatically, so you don't need to set up a load balancer.
The limits that matter are in Supabase:

1. **Sign-in rate limits (most important on campus).** Supabase limits how many sign-ups and
   sign-ins can come from one IP address. On campus Wi-Fi or in a computer lab, hundreds of
   students share the same public IP and will start seeing "Too many attempts". Go to
   **Authentication → Rate Limits** and raise the sign-up and sign-in limits for registration week.
2. **Email.** Supabase's built-in sender (password resets) is for testing only; see Email setup below.
3. **Plan.** Free projects are paused after a period of no activity and run on the smallest
   database. For the registration window and the event days, use the Pro plan. Under **Project
   Settings → Compute** you can temporarily pick a larger size and scale back afterwards.
4. **Test it once yourself:** register a test student, book, switch and cancel, and sign in at
   `/staff` before launch.

What the code already does to stay fast:

- Seat counts come from a counter column on each session (28 rows), not by counting thousands of
  bookings on every page refresh.
- Each open page checks seat counts about every 30–40 seconds (randomised so pages don't all
  hit at once) and stops checking while the tab is in the background.
- Booking locks only the session being booked (and the one being left), in a fixed order, so
  students booking different sessions never wait for each other and seat swaps can't deadlock.
- Access rules are written so Supabase evaluates them once per request, not once per row.
- `/api/config` is cached at Vercel's edge, so page loads don't each start a server function.

## Common tasks

- **Download attendee lists:** Staff portal → Registrations → **Download CSV**.
- **A student forgot their password:** they click **Forgot your password?** on the sign-in
  page and get a reset link by email.
- **Add the Google Meet link for a session:** Staff portal -> Registrations -> **View list** on the
  session -> **Meeting link**. Paste the link and click **Save link**. Super admins and organisers only.
- **Close a session to new bookings:** on that session's page, **Bookings → Close this session** (super admins and organisers).
  Nobody can book or switch into it until you press **Reopen for booking**; students already booked keep their seat, link and reminders
  and can still change or cancel. The database enforces it (`book_session` raises `SESSION_CLOSED`, migration `008`).
- **Send the link to everyone booked on a session:** on that session's page click
  **Send link to booked students** and confirm.
  You can press it again after changing a link.
  Big classes are sent by email through a queue in batches of 100 with a progress bar, so nothing times out
  (keep the page open until it says Finished). If it is interrupted, press **Resume sending**;
  messages that failed can be sent again with **Retry failed**, and nobody gets the same message twice.
  The daily job also finishes any broadcast left half-sent.
  Students also get a welcome email when they register, a confirmation when they book and a reminder the day before (daily job at 08:00 Ghana time).

## How messages reach students: email (Resend)

Every message goes by **email** from `workshop@kecworkshops.com` through **Resend** (paid plan: 50,000 emails a month, no daily cap):
the welcome email at registration, the booking confirmation, the reminder the day before and the joining link.
The code is in `api/_mail.js` (provider and templates), `api/_send.js` (who gets what) and `api/_queue.js` (broadcast queue).

- **Nothing is lost:** a failed welcome is retried at the student's next sign-in and by the daily job (for students who have not booked);
  a failed confirmation or reminder is retried by the daily job; a half-sent broadcast is finished by the daily job or **Resume sending**.
- **Booking after the link went out:** a new booking's confirmation carries the link. A student who joins a session after its link was
  broadcast and has not had that link (for example they left the session and came back) is emailed the link straight away, once;
  the daily job catches anyone missed. Each message records the link it carried (`email_log.link_url`, migration `009`).
- **Send the link to one group:** on a session page, choose All booked, Undergraduates only or Postgraduates only before Send link. Anyone already sent that exact link for that session is skipped, so nobody gets it twice (migration `010`). To resend it as a reminder, tick "Send again as a reminder" in the confirmation; it applies to that one send.
- **Nothing is sent twice:** every message has a key (queue row, or kind + student + session). Each send is claimed in the database first,
  and Resend's `Idempotency-Key` stops a retried request from going out twice.
- **Rate limits / outages:** each Resend request is retried up to 3 times (about 1, 2, 3 s apart, or what `Retry-After` says) before the message
  is left for a later attempt. Broadcasts go out 100 per request (Resend's batch limit).
- **Bad addresses:** only an address Resend rejects as a recipient is marked **Bounced** (staff see the tag) and skipped from then on.
  A sender or settings error is never blamed on the student: those messages are retried later.

Vercel -> Settings -> Environment Variables, then redeploy:

| Name | Value |
| --- | --- |
| `RESEND_API_KEY` | the API key from Resend (sending access) |
| `MAIL_FROM` | `Gemini Workshop <workshop@kecworkshops.com>` (the domain must be verified in Resend) |
| `MAIL_REPLY_TO` | optional, where replies go (default: the From address) |
| `CRON_SECRET` | any long random text (Vercel sends it with the daily job) |

Run the daily job by hand (for example to send a backlog straight away; it is safe to repeat):

```
curl -H "Authorization: Bearer $CRON_SECRET" https://www.kecworkshops.com/api/remind
```

It returns `sent`, `failed`, `remaining` (confirmations/reminders left for the next run), `welcomed` and `welcomeRemaining`.

Database: run the files in `supabase/migrations/` in order once (`002` to `010`); a brand-new project gets everything from `schema.sql`.
The tables `email_queue` and `email_log` hold the messages. Phone numbers are still collected at registration (they appear in the CSV)
but are no longer used for messages.

### Optional: Amazon SES instead of Resend

The SMTP path is still in `api/_mail.js` and is used only when `RESEND_API_KEY` is not set (or `MAIL_PROVIDER=smtp`).
The SES domain, DKIM, MAIL FROM (`mail.kecworkshops.com`), DMARC and bounce webhook (`/api/mail-events`, SNS topic `ses-events`)
are already set up in eu-west-1. To switch: add `SMTP_HOST=email-smtp.eu-west-1.amazonaws.com`, `SMTP_PORT=587`, `SMTP_USER`,
`SMTP_PASS` (SES SMTP credentials) and `MAIL_FROM` in Vercel, remove `RESEND_API_KEY`, redeploy.

## Busy day checklist (hundreds of students at once)

The site is built to absorb a rush: the page and the session list/seat counts (`/api/catalog`) are served from Vercel's CDN
(counts refresh every 5 seconds, booking still checks real capacity in the database), pages retry briefly when the server is busy,
and the server functions limit floods (`/api/login`: 8 tries per student number per 10 minutes; messages: 6 calls a minute per student).

Do these before sharing the link:
1. **Supabase -> Authentication -> Rate Limits:** raise **"Sign-ups and sign-ins"** to about **1000** per 5 minutes (and raise "Token refreshes").
   This matters most: every sign-in reaches Supabase from Vercel's servers, and students on campus Wi-Fi share one address, so the default
   limit would block most of them.
2. **Wake the database:** a free Supabase project pauses after a week without use. Open the site (or the Supabase dashboard) the day before.
   For a very large event, Supabase Pro (about $25/month) gives more capacity and never pauses.
3. **Email:** check the monthly usage in the Resend dashboard (50,000 a month on the current plan).
4. **During the rush:** watch Supabase -> Reports (API requests, errors) and Vercel -> Observability. If the traffic looks like an attack,
   turn on **Vercel -> Firewall -> Attack Challenge Mode**.

When the site is busy, students see "Lots of students are using the site right now…" and the page retries by itself; they do not need to refresh.

- **See raw data:** Supabase → Table Editor → `students`, `bookings`, `staff`.
- **Change session times, titles or capacity:** edit the `sessions` table in Supabase (Table Editor -> `sessions`:
  `starts_at`, `ends_at`, `title`, `capacity`). The website reads the list from the database when it opens, so there is
  nothing to change in `index.html`. Times are stored in GMT, which is Ghana time. Keep `day_key` as `d1`, `d2`, `d3`
  (one per day) and `slot` as the order of the session within the day.
- **Before launch, start fresh:** re-running `schema.sql` wipes all registrations and
  recreates everything. Do not re-run it once students have registered.
