# CRM Management Portal
Modules: Dashboard, Task Closer (per-task email/letter/WhatsApp action), Outbox/Approvals, Action Rules,
Workflow Analysis, Email Analysis (+ CRM updates after approval), Activity Log, Users (admin/manager/executive).

## Run
    npm install
    cp .env.example .env   # fill values; export them (e.g. `set -a; . ./.env; set +a`)
    DEMO=1 node server.js  # try with sample data first (prints the admin password on first run)
    node server.js         # live: uses Zoho. Keep DRY_RUN=1 until you have tested.

## Go live checklist
1. Fill Zoho, SMTP and Interakt values. 2. Run with DRY_RUN=1, close a test task, check Outbox. 3. Set DRY_RUN=0.
4. Put behind nginx + https, COOKIE_SECURE=1, run with pm2.
Data is in portal.db (SQLite). Back it up.

## Added: Macros, Automations, Scheduler, Task Assignment, Learning
- **Macros** tab: a saved set of steps (update fields → assign → note → follow-up task → email/letter/WhatsApp → close). Run by hand from Task Closer ("Run macro", with Preview).
- **Automations**: condition (subject/group text, status, overdue days) + macro + mode (Preview → Ask approval → Automatic) + schedule (daily at IST times / every N minutes / manual). Each task is handled once per automation. Set `SCHEDULER=0` to disable the timer.
- **Auto Approvals**: actions queued by automations in "Ask approval" mode.
- **Task Assignment**: employee roster (Active/Inactive, sync from Zoho), rules by subject/group, least-loaded assignment. Only tasks still owned by the configured "unassigned owner" are touched; tasks owned by others are never changed; inactive staff's tasks are only reassigned on your click; unmatched tasks wait for your decision.
- **Learning**: repeating a manual macro run or assignment 3+ times produces a rule suggestion; nothing is created without your click.
