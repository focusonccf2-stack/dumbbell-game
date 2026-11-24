# 啞鈴大力士 vs 紫雲魔王

一款在瀏覽器裡玩的小遊戲：黃豆大力士站在畫面下方，蓄力丟出火焰啞鈴，打倒在上方丟紫雲的紫雲魔王。

## 玩法

| 操作 | 電腦 | 手機 / 平板 |
|---|---|---|
| 左右移動 | ← → 方向鍵（或 A / D） | 下方 ◀ ▶ 按鈕 |
| 蓄力丟啞鈴 | 按住滑鼠左鍵，放開就丟出（朝游標方向） | 按住畫面，放開就朝那裡丟 |
| 音樂開關 | M 鍵或上方 ♪ 按鈕 | 上方 ♪ 按鈕 |
| 暫停 | P 或 Esc | — |

- 按得越久（最多約 1.1 秒），啞鈴飛得越快、火焰越大，打中魔王最多 +200 分；蓄力超過六成可以穿透紫雲。
- 打中魔王 **20 次** 就破關。
- 打掉小紫雲 **+10 分**。
- 被紫雲打中 **5 次** 就輸了。

## 用 GitHub Pages 放上網（免費）

1. 登入 GitHub，按右上角 **+ → New repository**，名稱例如 `dumbbell-game`，選 **Public**，按 **Create repository**。
2. 在新 repository 頁面點 **uploading an existing file**，把這個資料夾裡的**所有檔案和資料夾**（`index.html`、`css`、`js`、`assets`、`README.md`、`.nojekyll`）一起拖進去，按 **Commit changes**。
3. 到 **Settings → Pages**，Source 選 **Deploy from a branch**，Branch 選 **main**、資料夾 **/ (root)**，按 **Save**。
4. 等 1～2 分鐘，網址會出現在同一頁：`https://你的帳號.github.io/dumbbell-game/`

> 提示：`.nojekyll` 是隱藏檔，Mac 可在 Finder 按 `Cmd + Shift + .` 顯示。少了它通常也能正常運作。

## 檔案結構

```
dumbbell-game/
├── index.html            網頁入口
├── css/style.css         版面樣式
├── js/game.js            遊戲程式（玩法、動畫、音效、配樂）
├── assets/images/
│   ├── hero.png          主角完整圖（標題畫面）
│   ├── hero-body.png     主角身體（遊戲中）
│   ├── hero-arm.png      主角手臂（可旋轉做丟擲動作）
│   ├── dumbbell.png      啞鈴
│   └── boss.png          紫雲魔王
├── .nojekyll             讓 GitHub Pages 直接提供檔案
└── README.md
```

## 常見調整（都在 `js/game.js` 開頭）

- `WIN_HITS = 20`：打中魔王幾次破關
- `MAX_LIFE = 5`：生命數
- `CHARGE_MAX = 1.1`：蓄滿需要幾秒

音樂與吼聲都是用瀏覽器 Web Audio 即時合成，沒有外部音檔。

在自己電腦上試玩：直接用瀏覽器打開 `index.html` 即可。
