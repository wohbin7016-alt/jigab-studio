# 자동 백업 시스템 (판매 개시 시 구현)

## 목표
Cloudflare Worker에 Cron Trigger 추가 → 매일 03:00 KST 전체 라이선스 백업 → 프라이빗 GitHub 레포에 push

## 필요 세팅

### 1. GitHub 프라이빗 레포 생성
```bash
gh repo create jigab-backup --private
```

### 2. Fine-grained PAT 발급
- Settings → Developer settings → Personal access tokens → Fine-grained
- Repository access: `jigab-backup` only
- Permissions: Contents write
- Expire: 1 year
- Copy token

### 3. Worker에 시크릿 등록
```bash
cd ~/projects/jigab-studio/worker
echo "ghp_xxx..." | npx wrangler secret put GITHUB_TOKEN
```

### 4. wrangler.toml에 Cron Trigger 추가
```toml
[triggers]
crons = ["0 18 * * *"]  # UTC 18:00 = KST 03:00 (다음 날)
```

### 5. worker.js에 scheduled handler 추가
```js
export default {
  async fetch(request, env) { /* 기존 그대로 */ },

  async scheduled(event, env, ctx) {
    // 전체 KV 덤프
    const list = await env.LICENSES.list({ limit: 1000 });
    const keys = [];
    for (const k of list.keys) {
      const raw = await env.LICENSES.get(k.name);
      if (raw) keys.push({ key: k.name, ...JSON.parse(raw) });
    }
    const backup = { timestamp: new Date().toISOString(), count: keys.length, keys };
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(backup, null, 2))));

    // GitHub Contents API로 레포에 push
    const date = new Date().toISOString().slice(0, 10);
    const path = `backups/${date}.json`;
    const url = `https://api.github.com/repos/wohbin7016-alt/jigab-backup/contents/${path}`;

    // 기존 파일 있으면 sha 필요
    let sha = null;
    const existing = await fetch(url, {
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'User-Agent': 'jigab-backup' }
    });
    if (existing.ok) { sha = (await existing.json()).sha; }

    await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'User-Agent': 'jigab-backup',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Daily backup ${date}`,
        content,
        ...(sha ? { sha } : {}),
      }),
    });
  },
};
```

## 결과
- 매일 03:00 자동 백업
- 백업 파일: `github.com/wohbin7016-alt/jigab-backup/backups/2026-04-20.json` (프라이빗)
- 30일간 히스토리 자동 보관 (Git history)
- 장애 시 로컬로 clone → 복원 endpoint 호출

## 주의
- GitHub PAT 만료 1년마다 갱신 필요
- Cloudflare Cron Trigger는 Worker 유료 플랜 필요할 수 있음 (무료 티어도 가능, 1일 1회는 허용)

## 작업 예상 시간
- 약 30분 (셋업 + 테스트)

## 시점
**당근마켓 판매 개시 시 구현**. 현재는 수동 백업 (주 1회 admin.html → 💾 버튼)으로 충분.
