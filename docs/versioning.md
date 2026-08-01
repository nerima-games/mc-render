# バージョニングと公開

## 1. 現状

| 項目 | 値 |
| --- | --- |
| `version` | `0.1.0` |
| 公開状態 | **未公開**。GitHub Packages にも上げていない |
| `main` / `types` / `exports` | **TypeScript ソースを直接指す**（`./src/index.ts`）。ビルド成果物ではない |
| ビルドパイプライン | **無い**。全 tsconfig が `noEmit: true` の検査専用 |
| `dependencies` | `effect` のみ |

## 2. なぜ `0.x` に留めるのか

plan.md §6 Step 3 / §8:

> 界面が安定した（APIロック4週間無変更）リポジトリから GitHub Packages 等へ npm 公開 +
> changesets 運用に切り替え。それまでは dev-meta workspace 統合で開発。

> **新規構築初期は全界面が高churn** → npm公開を遅らせ dev-meta workspace で開発（§6 Step 0）。
> bump連鎖を構造的に回避

mc-render の実行時依存元は mc-playground-kit だけだが、**mc-render 自身が 3 リポジトリに依存する**
（mc-meshing / mc-sim / mc-worldgen）。つまり mc-render が publish できるのは、
その 3 つが先に publish されて安定した後である（plan.md §6 Step 3 の bottom-up）。

さらに mc-render は THREE.js アダプタが**まだ存在しない**。界面が安定するもしないも、
本体が無い。他のどのリポジトリより publish が遠い。

開発中は `mc-dev-meta` workspace が 16 リポジトリの clone を `repos/` に並べ、
`workspace:*` 解決でモノレポ同等の DX を提供する（plan.md §6 Step 0-2）。
公開しなくても他リポジトリから使える状態はここで作る。

## 3. `0.x` → `1.0.0` の条件

`1.0.0` は「完成した」の意味ではなく「**この界面を壊さないと約束する**」の意味である。
mc-sim が `1.0.0` を出せるのは、以下がすべて満たされたとき。

1. **[testing.md](./testing.md) §2 の完了条件を満たしている。**
   テスト green **かつ**内蔵 fixture ビューアが操作可能。
   ビューアには THREE.js アダプタが要るので、これが最大の関門である。
2. **maintainer(take)が昇格させてよいと裁量判断する**（[RELEASE_STANDARD.md §4.2](https://github.com/nerima-games/.github/blob/main/RELEASE_STANDARD.md#42-新しい昇格ポリシー人間による裁量判断)）。
   旧・日数計測ベースの自動ゲート（「APIロックファイルが4週間変更されていない」）は org 全体で
   廃止された（[API_STANDARD.md §4](https://github.com/nerima-games/.github/blob/main/API_STANDARD.md)）。
   代替の定量基準は導入しない。判断材料は上位階層（`mc-playground-kit` / `mc-compose`）が
   実際に消費し動作確認したかどうかなど、都度異なってよい。
3. **mc-playground-kit が実際に消費して契約を確認している。**
   使われていない界面に「壊さない」と約束しても意味がない。
4. **[public-api.md](./public-api.md) §7 の未設計 API が埋まっている。**
   特に **`WorldRenderer`**。plan.md §3.9 の筆頭 API である。
   **2026-07-28: 本体は書かれた**（`application/world-renderer.ts`）ので、
   ここに残っているのは**ダーティ購読の配線だけ**である。
   ダーティ通知の宛先は決まった —— `mc-worldgen` の `ChunkStore.subscribeDirty` である
   （plan.md §3.8 は mc-sim の API としているが、フラグを持つのは §3.7 により
   worldgen 側で、sim 経由にすると毎フレーム全チャンクのポーリングになる）。
   §2.1 に `render → worldgen` のエッジは既にあるので、購読に新しい依存は要らない。
5. `domain/kernel-vocabulary.ts` が削除され、`@nerima-games/mc-kernel` を
   `dependencies` から参照している（§5 参照）。

### 3.1 ブロッカーの連鎖 —— **2026-07-28 に前半が反証された**

かつてここには次の連鎖が書いてあった。

```
mc-worldgen の ChunkStore.subscribeDirty（決定済み）
  → mc-render の WorldRenderer が書ける
    → THREE.js アダプタが完成する
      → 内蔵 fixture ビューアが動く
        → 完了条件を満たす
          → maintainer の裁量判断
            → 1.0.0
```

**最初の 2 本の矢印は成立していなかった。** `WorldRenderer` も THREE シームも、
`subscribeDirty` が 1 行も無いまま着地している。理由は後から見ると単純で、
`setChunk(key, buffers)` は**誰が呼ぶかを知らなくても定義できる** ——
購読はレンダラの**引数の出どころ**であって、レンダラの設計への入力ではなかった。

依存を上流に描きすぎると、**実際には並行して進められる作業が直列に見える**。
このリポジトリはそれを 1 回やり、その間ずっと「1 行も無い」と書き続けていた。

現在の連鎖:

```
mc-worldgen / mc-meshing が publish される（または vite alias に入る）
  → ワールドデータが mc-render に届く
    → 内蔵 fixture ビューアが動く / ライトグリッドの適用が書ける
      → 完了条件を満たす
        → maintainer の裁量判断
          → 1.0.0
```

**最上流は「未設計」ではなく「未 publish」である。** これは設計待ちではなく順序待ちで、
plan.md §6 Step 3 のボトムアップ publish がそのまま解く。
それとは独立に進む作業がシーム側に残っている（[responsibility.md](./responsibility.md) §2.3 の
`InstancedMesh` / `ShaderMaterial` / `EffectComposer` / `TextureLoader`）。

### 3.1 `0.x` の間の運用

`0.x` では semver の互換保証が働かない（`^0.1.0` は `0.2.0` を受け入れない）。
mc-dev-meta workspace で開発している間は問題にならないが、publish 後 `1.0.0` 前の期間は:

- **破壊的変更 = minor bump**（`0.1.0` → `0.2.0`）
- **後方互換の追加・修正 = patch bump**（`0.1.0` → `0.1.1`）
- 下流は `~0.1.0` ではなく **`0.1.x` を明示ピン**して、意図しない minor 取り込みを防ぐ

## 4. GitHub Packages

`package.json`:

```json
"publishConfig": {
  "registry": "https://npm.pkg.github.com",
  "access": "restricted"
}
```

- スコープは `@nerima-games`。GitHub Organization `nerima-games` 配下のリポジトリと対応する。
- `access: restricted`（private）。plan.md §9 の未決事項「パッケージ公開先」は
  GitHub Packages で確定したものとして扱う。
- 消費側は `.npmrc` に `@nerima-games:registry=https://npm.pkg.github.com` と
  `//npm.pkg.github.com/:_authToken=...` が要る。**現在の `.npmrc` にはまだ書いていない**
  （公開物が無いため）。最初の publish と同時に 16 リポジトリ分を揃える。

## 5. `three` / `@types/three` の入れ方 —— `devDependencies`、`"DOM"` 無し

参照実装は `three@^0.170.0` / `@types/three@^0.170.0` を使う（`package.json:57,59`）。
plan.md §3.9 も THREE.js 描画一式を mc-render の責務としている。
**両方とも `^0.170.0` で入った。ただし `devDependencies` に、である。**

この節はかつて「まだ入れていない理由」であり、入れるときの手順を 4 項目で予告していた。
**予告した 4 項目のうち、実際に起きたのは 1 と 4 だけである。** 予告が外れた 2 が
この節でいちばん重要なので、外れた形で残す。

### 5.1 何が起きたか

1. **`dependencies` ではなく `devDependencies` に `three` と `@types/three`。**
   出荷ソースは THREE.js を 1 行も import していない。`application/three-surface.ts` が
   使う 7 個のコンストラクタと ~20 個のメンバを構造的な型として書き、
   ホストが本物の名前空間を渡す。`three` が要るのは
   `test/fixtures/three-surface.ts` を**本物の `.d.ts` に対してコンパイルする**
   テストのためだけである。
   `test/three-surface.test.ts` は「出荷ファイルに `three` の import が 1 つも無いこと」を
   grep で固定しており、それは `pnpm typecheck` には**見えない**性質である ——
   `skipLibCheck: true` は `.d.ts` の中の DOM 参照を黙らせたうえで、
   使用側に `any` を渡す。型のあるシームに見えて、検査は 1 つも走らない。

2. **`tsconfig.base.json` の `lib` に `"DOM"` は入っていない。予告は外れた。**
   予告は「THREE のクラス階層はその手（構造的な型）が効く大きさではない」と書いていた。
   **効いた。** レンダラが要るのはクラス階層ではなく 7 個のコンストラクタだったからである。
   代償は `ThreeSurface<TCanvas, TGeometry, TMaterial>` の型引数 3 つで、
   3 つとも「その位置の実型が `lib.DOM` か `three` を名指さないと書けない」ために存在する。
   `application/three-surface.ts` のヘッダに、なぜメソッドは双変で
   コンストラクタは反変なのか——実測で分かったこと——が書いてある。
   `"WebWorker"` はまだ先（メッシャのワーカープール）。

3. `types` に `"three"` は不要、は予告どおり（そもそも `import` していない）。

4. `vitest.config.ts` の `coverage.include` の見直しは**まだ**。GPU 依存コードは
   Node 計測から漏れる（[testing.md](./testing.md) §6）。`application/world-renderer.ts` が
   その最初の実例になった。

### 5.2 バージョンを一致させること

`three` と `@types/three` は**同じ範囲文字列**でなければならない。
THREE は minor でも破壊的変更を入れるので、`@types/three` が minor 1 つ先だと
「入っていないライブラリを記述した型」になる。`test/three-surface.test.ts` が
この一致を固定している。

バージョンは `0.170.0` を出発点とするが、**移植時に再確認すること**。
THREE は minor でも破壊的変更を入れる。参照実装は `three/addons/postprocessing/*` の
`EffectComposer` / `RenderPass` / `GTAOPass` / `UnrealBloomPass` / `BokehPass` / `SMAAPass` /
`OutputPass` を直接使っており（`session-post-processing.ts:3-9`）、
addons のパス構成は THREE のバージョンで変わったことがある。

`GodRaysPass` と `CompositePass` は参照実装の**自作**で、別ライブラリではない。

## 6. `domain/kernel-vocabulary.ts` の削除

**publish 運用より前に片付ける負債。**

nothing-is-published のブートストラップ問題を回避するため、mc-kernel の語彙のうち
mc-render が使う分だけを `domain/kernel-vocabulary.ts` にミラーしてある。
mc-kernel が publish されたら:

1. `@nerima-games/mc-kernel` を `package.json#dependencies` に追加
2. `domain/kernel-vocabulary.ts` を削除
3. `from './kernel-vocabulary'` を `from '@nerima-games/mc-kernel'` に置換

**これで型検査が通らなければ、ミラーが drift しており、その drift 自体がバグである。**
ミラーは意図的に最小（mc-render が実際に使う分だけ）にしてあり、これは「正直に保つ対象を小さくする」ため。

**ただし「最小」だけでは drift は防げない。** ブランドは**文字列**でキーされるので
（`Brand.Brand<'DeltaTimeSecs'>`）、ミラーが kernel と違う述語で refine していても
TypeScript にとっては同じ型である。`Context.Tag` も同様で、同じキーの 2 つのクラスは
実行時には同じサービスである。**型検査器が構造的に捕まえられない種類の drift** であり、
ロスター内で実際に 2 件起きていた（mc-sim の 1 フィールド `ClockService`、
mc-physics の `[0.001, 0.05]` に refine された `DeltaTimeSecs`）。

そこで `test/kernel-mirror.test.ts` が、ブランドの述語と `CameraPoseSnapshot` の形を
kernel の文書化された定義に対して assert している（[testing.md](./testing.md) §4.1）。
上の 3 手順の約束は、このテストによってはじめて実効性を持つ。

なお `index.ts` はこのミラーを **re-export していない**。consumer が mc-render 経由で
kernel の語彙を取ると真実の出所が 2 つになり、上記の削除が破壊的変更に化けるためである。

## 7. ビルド / publish パイプライン（完了時に追加）

現在 `noEmit: true` で `exports` が `.ts` を指しているのは、**consumer が TypeScript を
直接コンパイルする前提**の暫定形。dev-meta workspace 内では動くが、publish 物としては不可。

完了条件到達時に追加するもの:

| 項目 | 内容 |
| --- | --- |
| ビルド | `tsconfig.build.json` の `noEmit` を外し `outDir: dist` + `declaration` |
| `exports` | `{ ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }` |
| `files` | `dist` 中心に変更 |
| changesets | plan.md §6 Step 3。bump とチェンジログの運用 |
| publish ワークフロー | `.github/workflows/` に追加。タグ or changeset 起点 |
| カバレッジ 99% ゲート | `vitest.config.ts` + CI（[testing.md](./testing.md) §5） |

`.gitignore` は既に `dist/` `build/` `out/` を無視するようにしてある。

**APIロック機構（`api-lock.md` / `scripts/api-lock.ts` / `pnpm api:check`）は org 全体で
廃止された**（[API_STANDARD.md §4](https://github.com/nerima-games/.github/blob/main/API_STANDARD.md)）。
公開面のレビューは PR 差分そのもので行い、日数計測ベースの自動ゲートには戻さない。
`public-api.md` §8 の記述はこの廃止に合わせて更新が必要な既知の追従作業として残っている。

**mc-render 固有の追加項目**: テクスチャアセットの同梱（plan.md §5.3
「アセットは消費者に同梱（テクスチャ→render、音声→audio）」）。
`files` にアセットディレクトリを含め、バンドラがそれをどう解決するかを決める必要がある。
現在の `files` にはアセット項目が無い。

## 8. 依存の固定

| 依存 | 現在 | 方針 |
| --- | --- | --- |
| `effect` | `^3.20.0` | 16 リポジトリで**同一メジャーに揃える**。Context / Layer の型が跨るため、メジャーが混ざると合成できない |
| `@nerima-games/*` | 未宣言 | publish 後は**厳密ピン**（`0.3.1` のように範囲なし）。plan.md の bottom-up publish-then-pin |
| `three` / `@types/three` | `^0.170.0`（**devDependencies**） | §5。出荷ソースは import しない。**両者のバージョンを一致させる**（`test/three-surface.test.ts` が固定） |
| `typescript` / `vitest` | `^` 付き | ツールチェーンは揃えるが厳密ピンはしない |
| `oxlint` | **package.json devDependency ではない** | `flake.nix` の devShell が `pkgs.oxlint`（nixpkgs 追従）を入れる。16 リポジトリが各自 npm 解決で drift するのを防ぐため、Nix 側で一本化した単一ソース |
| `packageManager` | `pnpm@9.15.0` | 16 リポジトリで同一 |

`engines.node` は `>=22.0.0`。`flake.nix` の devShell が `nodejs_22` を入れる。
