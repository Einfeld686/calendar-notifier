import type { EventCandidate, PublishedEvent } from "./types.js";
import { feedDefinitions } from "./services/ics.js";
import { humanDateRange } from "./lib/time.js";
import { brandLabel, escapeHtml, eventTypeLabel } from "./lib/utils.js";

export function renderCss(): string {
  return `
:root {
  --bg: #f5efe7;
  --panel: rgba(255, 252, 247, 0.9);
  --ink: #1f2a2e;
  --muted: #5b646a;
  --line: rgba(31, 42, 46, 0.12);
  --accent: #ad3f32;
  --accent-2: #205f5b;
  --shadow: 0 20px 60px rgba(32, 48, 58, 0.12);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--ink);
  background:
    radial-gradient(circle at top left, rgba(173, 63, 50, 0.18), transparent 28%),
    radial-gradient(circle at right, rgba(32, 95, 91, 0.14), transparent 22%),
    linear-gradient(180deg, #faf5ef 0%, #f4ede3 100%);
  font-family: "Hiragino Sans", "Yu Gothic", "BIZ UDPGothic", sans-serif;
}
a { color: var(--accent-2); }
.shell {
  width: min(1120px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 28px 0 72px;
}
.hero {
  padding: 28px;
  border: 1px solid var(--line);
  border-radius: 28px;
  background: linear-gradient(145deg, rgba(255,255,255,0.84), rgba(255,250,244,0.82));
  box-shadow: var(--shadow);
}
.hero h1, h2, h3 { margin: 0 0 12px; line-height: 1.15; }
.hero p, p { line-height: 1.7; color: var(--muted); }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
  margin-top: 24px;
}
.panel {
  border: 1px solid var(--line);
  border-radius: 22px;
  padding: 20px;
  background: var(--panel);
  box-shadow: var(--shadow);
}
.panel table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.95rem;
}
.panel th, .panel td {
  padding: 10px 8px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}
.panel th { color: var(--muted); font-weight: 600; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0 0; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(32, 95, 91, 0.1);
  color: var(--accent-2);
  font-size: 0.9rem;
}
.list {
  display: grid;
  gap: 14px;
}
.card {
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: rgba(255,255,255,0.76);
}
.eyebrow {
  color: var(--accent);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: 0.8rem;
}
.status {
  display: inline-flex;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(173, 63, 50, 0.12);
  color: var(--accent);
  font-size: 0.85rem;
  font-weight: 700;
}
form.inline { display: inline-flex; gap: 8px; align-items: center; flex-wrap: wrap; }
input[type="text"], textarea {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 12px;
  background: rgba(255,255,255,0.95);
  font: inherit;
}
textarea { min-height: 120px; }
button {
  border: 0;
  border-radius: 999px;
  padding: 10px 16px;
  background: var(--accent-2);
  color: white;
  font: inherit;
  cursor: pointer;
}
button.secondary { background: #7a857f; }
button.danger { background: var(--accent); }
.meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  margin-top: 16px;
}
.meta strong { display: block; font-size: 0.8rem; color: var(--muted); margin-bottom: 4px; }
nav {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
nav a {
  text-decoration: none;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(32,95,91,0.1);
}
code {
  font-family: "SF Mono", "JetBrains Mono", monospace;
  background: rgba(31, 42, 46, 0.06);
  padding: 0.15rem 0.35rem;
  border-radius: 0.4rem;
}
pre {
  overflow-x: auto;
  background: #1b2328;
  color: #eef6f5;
  padding: 18px;
  border-radius: 18px;
}
@media (max-width: 720px) {
  .shell { width: min(100vw - 20px, 1120px); padding-top: 18px; }
  .hero, .panel { border-radius: 20px; padding: 18px; }
}
`;
}

export function renderLayout(title: string, body: string, navItems: Array<{ href: string; label: string }> = []): string {
  const nav = navItems.length
    ? `<nav>${navItems.map((item) => `<a href="${item.href}">${escapeHtml(item.label)}</a>`).join("")}</nav>`
    : "";
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/assets/app.css" />
  </head>
  <body>
    <main class="shell">
      ${nav}
      ${body}
    </main>
  </body>
</html>`;
}

export function renderHome(events: PublishedEvent[], baseUrl: string): string {
  const feedCards = (Object.keys(feedDefinitions) as Array<keyof typeof feedDefinitions>)
    .map((feedKey) => {
      const feed = feedDefinitions[feedKey];
      return `<article class="card">
        <div class="eyebrow">${feedKey.toUpperCase()}</div>
        <h3>${escapeHtml(feed.name)}</h3>
        <p>${escapeHtml(feed.description)}</p>
        <p><code>${escapeHtml(`${baseUrl}/cal/${feedKey}.ics`)}</code></p>
      </article>`;
    })
    .join("");

  const eventCards = events.length
    ? events
        .map(
          (event) => `<article class="card">
            <div class="eyebrow">${escapeHtml(brandLabel(event.brand))}</div>
            <h3><a href="/events/${encodeURIComponent(event.eventSlug)}">${escapeHtml(event.title)}</a></h3>
            <p>${escapeHtml(humanDateRange(event.startsAtJst, event.endsAtJst, event.allDay))}</p>
            <p>${escapeHtml(event.summary)}</p>
          </article>`,
        )
        .join("")
    : `<article class="card"><h3>現在公開中の予定はまだありません</h3><p>初回巡回または承認後に、ここへ confirmed / published イベントが表示されます。</p></article>`;

  return renderLayout(
    "日本主要セール公開カレンダー",
    `<section class="hero">
      <div class="eyebrow">Public Subscription Calendar</div>
      <h1>日本主要セールを、根拠つきの公開購読カレンダーで配る</h1>
      <p>一度 URL を登録すれば、無印良品・楽天・Amazon の主要セールを読み取り専用の公開カレンダーとして追えます。公開面では pending_review を出さず、根拠要約と出典 URL だけを見せます。</p>
      <div class="chips">
        <span class="chip">匿名購読</span>
        <span class="chip">読み取り専用</span>
        <span class="chip">出典つき</span>
        <span class="chip">当日中更新</span>
      </div>
    </section>
    <section class="grid">
      <div class="panel">
        <h2>購読フィード</h2>
        <div class="list">${feedCards}</div>
      </div>
      <div class="panel">
        <h2>直近の公開予定</h2>
        <div class="list">${eventCards}</div>
      </div>
    </section>`,
    [
      { href: "/", label: "公開トップ" },
      { href: "/guide", label: "購読ガイド" },
      { href: `${baseUrl}/cal/all.ics`, label: "all.ics" },
    ],
  );
}

export function renderGuide(baseUrl: string): string {
  return renderLayout(
    "購読ガイド",
    `<section class="hero">
      <div class="eyebrow">Guide</div>
      <h1>購読の入れ方</h1>
      <p>このサービスは <strong>import ではなく subscribe</strong> を前提にしています。利用者のアプリ側の更新時刻は制御できないため、約束するのは公開側を当日中に更新することだけです。</p>
    </section>
    <section class="grid">
      <article class="panel">
        <h2>Google Calendar</h2>
        <p>パソコン版で「URL で追加」を使う前提です。<code>${escapeHtml(`${baseUrl}/cal/all.ics`)}</code> のような公開 URL を登録してください。</p>
      </article>
      <article class="panel">
        <h2>Apple Calendar</h2>
        <p>「Web アドレスから新規購読」を使います。購読後の予定表は読み取り専用で、内容は提供者側が管理します。</p>
      </article>
      <article class="panel">
        <h2>Outlook on the web</h2>
        <p><strong>import</strong> は写し込みで、その後の自動更新はありません。<strong>subscribe</strong> を選ぶと更新対象になりますが、反映に 24 時間以上かかる場合があります。</p>
      </article>
    </section>`,
    [
      { href: "/", label: "公開トップ" },
      { href: `${baseUrl}/cal/lite.ics`, label: "lite.ics" },
    ],
  );
}

export function renderEventDetail(event: PublishedEvent): string {
  const feedList = ["all", event.brand, isLiteEvent(event) ? "lite" : null].filter(Boolean).join(", ");
  const statusLabel = event.icalStatus === "CANCELLED" ? "中止" : event.status === "ended" ? "終了" : "公開中";
  return renderLayout(
    event.title,
    `<section class="hero">
      <div class="eyebrow">${escapeHtml(brandLabel(event.brand))}</div>
      <h1>${escapeHtml(event.title)}</h1>
      <span class="status">${escapeHtml(statusLabel)}</span>
      <div class="meta">
        <div><strong>イベント種別</strong>${escapeHtml(eventTypeLabel(event.eventType))}</div>
        <div><strong>開催期間</strong>${escapeHtml(humanDateRange(event.startsAtJst, event.endsAtJst, event.allDay))}</div>
        <div><strong>掲載フィード</strong>${escapeHtml(feedList)}</div>
        <div><strong>確認時刻</strong>${escapeHtml(event.verifiedAt)}</div>
      </div>
    </section>
    <section class="panel">
      <h2>根拠要約</h2>
      <p>${escapeHtml(event.summary)}</p>
      <div class="meta">
        <div><strong>出典 URL</strong><a href="${escapeHtml(event.sourceUrl)}">${escapeHtml(event.sourceUrl)}</a></div>
        <div><strong>初回公開</strong>${escapeHtml(event.publishedAt)}</div>
        <div><strong>最終更新</strong>${escapeHtml(event.lastModifiedUtc)}</div>
        <div><strong>SEQUENCE</strong>${String(event.sequence)}</div>
      </div>
    </section>`,
    [
      { href: "/", label: "公開トップ" },
      { href: "/guide", label: "購読ガイド" },
    ],
  );
}

export function renderAdminReviewList(candidates: Array<EventCandidate & { observation?: { fetchedAt: string } | null }>): string {
  const rows = candidates.length
    ? candidates
        .map(
          (candidate) => `<tr>
          <td><a href="/admin/review/${candidate.id}">${candidate.id}</a></td>
          <td>${escapeHtml(candidate.title)}</td>
          <td>${escapeHtml(brandLabel(candidate.brand))}</td>
          <td>${escapeHtml(eventTypeLabel(candidate.eventType))}</td>
          <td>${escapeHtml(candidate.startsAtJst && candidate.endsAtJst ? humanDateRange(candidate.startsAtJst, candidate.endsAtJst, candidate.allDay) : "自動確定できず")}</td>
          <td>${escapeHtml(candidate.observation?.fetchedAt ?? "ルール生成")}</td>
          <td>${candidate.validationFlags.map((flag) => `<div><code>${escapeHtml(flag)}</code></div>`).join("")}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="7">現在 pending_review はありません。</td></tr>`;

  return renderLayout(
    "審査待ち一覧",
    `<section class="hero">
      <div class="eyebrow">Admin Review</div>
      <h1>保留案件一覧</h1>
      <p>自動判定で確定しなかった候補だけを表示します。公開面にはここにあるイベントは一切出ません。</p>
    </section>
    <section class="panel">
      <table>
        <thead>
          <tr><th>ID</th><th>タイトル</th><th>ブランド</th><th>種別</th><th>候補期間</th><th>取得時刻</th><th>検証結果</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`,
    [
      { href: "/admin/review", label: "審査待ち" },
      { href: "/admin/events", label: "公開台帳" },
      { href: "/", label: "公開トップ" },
    ],
  );
}

export function renderAdminReviewDetail(params: {
  candidate: EventCandidate;
  observationText: string | null;
  reviewHistory: Array<{ reviewedAt: string; action: string; reviewerLabel: string; reason: string | null }>;
  hasPublishedMatch: boolean;
}): string {
  const { candidate, observationText, reviewHistory, hasPublishedMatch } = params;
  const action = hasPublishedMatch ? "publish_update" : "approve";
  const reviewRows =
    reviewHistory.length > 0
      ? reviewHistory
          .map(
            (item) => `<tr><td>${escapeHtml(item.reviewedAt)}</td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(
              item.reviewerLabel,
            )}</td><td>${escapeHtml(item.reason ?? "")}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="4">まだ操作履歴はありません。</td></tr>`;

  const canPublish = Boolean(candidate.startsAtJst && candidate.endsAtJst);

  return renderLayout(
    `審査候補 #${candidate.id}`,
    `<section class="hero">
      <div class="eyebrow">Candidate #${candidate.id}</div>
      <h1>${escapeHtml(candidate.title)}</h1>
      <p>${escapeHtml(candidate.publicEvidenceSummary)}</p>
      <div class="meta">
        <div><strong>ブランド</strong>${escapeHtml(brandLabel(candidate.brand))}</div>
        <div><strong>種別</strong>${escapeHtml(eventTypeLabel(candidate.eventType))}</div>
        <div><strong>候補期間</strong>${escapeHtml(
          candidate.startsAtJst && candidate.endsAtJst ? humanDateRange(candidate.startsAtJst, candidate.endsAtJst, candidate.allDay) : "自動確定できず",
        )}</div>
        <div><strong>出典</strong><a href="${escapeHtml(candidate.sourceUrl)}">${escapeHtml(candidate.sourceUrl)}</a></div>
      </div>
    </section>
    <section class="grid">
      <article class="panel">
        <h2>検証結果</h2>
        <div class="chips">${candidate.validationFlags.map((flag) => `<span class="chip">${escapeHtml(flag)}</span>`).join("")}</div>
        <form method="post" action="/admin/review/${candidate.id}/action">
          <input type="hidden" name="action" value="${action}" />
          <label for="reason">メモ</label>
          <textarea id="reason" name="reason" placeholder="承認理由や補足を入力">${hasPublishedMatch ? "published event update" : "manual approval"}</textarea>
          <div class="chips">
            <button type="submit" ${canPublish ? "" : "disabled"}>${hasPublishedMatch ? "更新を公開" : "承認して公開"}</button>
          </div>
        </form>
        <form method="post" action="/admin/review/${candidate.id}/action" style="margin-top:12px">
          <input type="hidden" name="action" value="reject" />
          <label for="reject-reason">却下理由</label>
          <textarea id="reject-reason" name="reason" placeholder="却下理由">${candidate.startsAtJst ? "source text does not meet publication rules" : "missing normalized date range"}</textarea>
          <div class="chips">
            <button class="danger" type="submit">却下</button>
          </div>
        </form>
      </article>
      <article class="panel">
        <h2>本文抜粋</h2>
        <pre>${escapeHtml(observationText ?? "証拠本文は保存されていません。")}</pre>
      </article>
    </section>
    <section class="panel">
      <h2>操作履歴</h2>
      <table>
        <thead><tr><th>時刻</th><th>操作</th><th>担当</th><th>理由</th></tr></thead>
        <tbody>${reviewRows}</tbody>
      </table>
    </section>`,
    [
      { href: "/admin/review", label: "審査待ち" },
      { href: "/admin/events", label: "公開台帳" },
    ],
  );
}

export function renderAdminEvents(events: PublishedEvent[]): string {
  const rows = events.length
    ? events
        .map(
          (event) => `<tr>
            <td><a href="/events/${encodeURIComponent(event.eventSlug)}">${escapeHtml(event.title)}</a></td>
            <td>${escapeHtml(brandLabel(event.brand))}</td>
            <td>${escapeHtml(humanDateRange(event.startsAtJst, event.endsAtJst, event.allDay))}</td>
            <td>${escapeHtml(event.icalStatus)}</td>
            <td>${event.sequence}</td>
            <td>
              <form class="inline" method="post" action="/admin/events/${encodeURIComponent(event.eventSlug)}/cancel">
                <input type="text" name="reason" value="manual cancellation" />
                <button class="danger" type="submit">中止配信</button>
              </form>
            </td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="6">公開済みイベントはありません。</td></tr>`;

  return renderLayout(
    "公開台帳",
    `<section class="hero">
      <div class="eyebrow">Admin Ledger</div>
      <h1>公開済みイベント台帳</h1>
      <p>公開中・終了済み・中止済みのイベントを 1 か所で確認します。</p>
    </section>
    <section class="panel">
      <table>
        <thead>
          <tr><th>イベント</th><th>ブランド</th><th>開催期間</th><th>ICAL 状態</th><th>SEQUENCE</th><th>操作</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`,
    [
      { href: "/admin/review", label: "審査待ち" },
      { href: "/admin/events", label: "公開台帳" },
      { href: "/", label: "公開トップ" },
    ],
  );
}

function isLiteEvent(event: Pick<PublishedEvent, "eventType">): boolean {
  return [
    "muji_ryohin_week",
    "amazon_prime_day",
    "amazon_prime_thanks_festival",
    "amazon_black_friday",
    "rakuten_super_sale",
  ].includes(event.eventType);
}
