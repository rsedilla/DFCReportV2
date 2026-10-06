# Restoring a backup

The drill that proved the nightly backup on 2026-09-28: one backup copied from Google
Drive, decrypted, restored into a scratch database, compared table by table with
production, and removed. Production is not written to at any step.

**Restoring over production has never been tested.** If production itself is lost, run
this drill first to prove the backup, then plan the switch with the owner; do not improvise
it from these steps.

This repository is public, so nothing here names the server, a passphrase or where one is
kept. The words in CAPITALS are placeholders. Each one fails if pasted unchanged, and step 1
shows where to read its value.

Run every step as root in the server's console, one line at a time, and read the output
before going on.

## 1. Read the values from the backup job

```bash
crontab -l
```

One line runs the nightly backup script (`BACKUP_SCRIPT`). Print it:

```bash
cat BACKUP_SCRIPT
```

Note three things from it: the production database (`PROD_DB`), the Drive remote and
folder (`DRIVE_FOLDER`, written `remote:folder`), and the passphrase file
(`PASSPHRASE_FILE`).

## 2. Copy the newest backup from Drive

```bash
mkdir -p -m 700 /root/restore-test && rclone lsl DRIVE_FOLDER | sort -k4 | tail -n 3
```

The last line is the newest backup (`BACKUP_FILE`, ending `.dump.gpg`). Copy it:

```bash
rclone copy DRIVE_FOLDER/BACKUP_FILE /root/restore-test/ && ls -l /root/restore-test/
```

Its size should match the line `rclone lsl` printed.

## 3. Decrypt it and look inside

```bash
gpg --batch --yes --no-symkey-cache --pinentry-mode loopback --passphrase-file PASSPHRASE_FILE -o /root/restore-test/prod.dump -d /root/restore-test/BACKUP_FILE && pg_restore --list /root/restore-test/prod.dump | grep -c 'TABLE DATA'
```

The number is how many tables hold data, 24 in September 2026. A backup made before
2026-09-28 needs the passphrase in use before that day, which the server no longer keeps once
those backups have expired.

If the passphrase file is gone, use the copy in the owner's password manager. Type it at the
prompt, where it is not shown on screen, and never paste it into a chat or a document:

```bash
read -rsp 'Passphrase: ' P; echo; printf %s "$P" | gpg --batch --yes --no-symkey-cache --pinentry-mode loopback --passphrase-fd 0 -o /root/restore-test/prod.dump -d /root/restore-test/BACKUP_FILE && pg_restore --list /root/restore-test/prod.dump | grep -c 'TABLE DATA'; unset P
```

## 4. Restore it into a scratch database

```bash
sudo -u postgres createdb dfc_restore_test && sudo -u postgres pg_restore --exit-on-error -d dfc_restore_test < /root/restore-test/prod.dump && echo "RESTORED"
```

## 5. Compare every table with production

```bash
for t in $(sudo -u postgres psql -At -d PROD_DB -c "select tablename from pg_tables where schemaname='public' order by 1"); do a=$(sudo -u postgres psql -At -d PROD_DB -c "select count(*) from public.\"$t\""); b=$(sudo -u postgres psql -At -d dfc_restore_test -c "select count(*) from public.\"$t\""); [ "$a" = "$b" ] && s=same || s=DIFFERENT; echo "$t prod=$a restored=$b $s"; done
```

Every line should say `same`, unless the table was written after the backup was taken. Ask
before treating any `DIFFERENT` as harmless.

## 6. Remove the scratch database and the files

```bash
sudo -u postgres dropdb dfc_restore_test && rm -rf /root/restore-test && echo "CLEANED"
```

## 7. Record it

Note the date, the backup file and the result on the pilot checklist, so the next drill
knows when the last one ran.
