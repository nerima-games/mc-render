# バージョニングと公開

## 1. 現状

| 項目 | 値 |
| --- | --- |
| `version` | `0.1.0` |
| 公開状態 | **未公開**。GitHub Packages にも上げていない |
| `main` / `types` / `exports` | **TypeScript ソースを直接指す**（`./index.ts`）。ビルド成果物ではない |
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
2. **APIロックファイルが 4 週間変更されていない**（plan.md §6 Step 3）。
   ツール選定（plan.md §9 の未決事項「api-extractor 相当の Effect-TS 互換手段」）は決着し、
   `api-lock.md` / `scripts/api-lock.ts` / `pnpm api:check` として実装済み
   （[public-api.md](./public-api.md) §8）。**計測の起点は `api-lock.md` が最後に変わったコミット。**
3. **mc-playground-kit が実際に消費して契約を確認している。**
   使われていない界面に「壊さない」と約束しても意味がない。
4. **[public-api.md](./public-api.md) §7 の未設計 API が埋まっている。**
   特に **`WorldRenderer`**。plan.md §3.9 の筆頭 API でありながら 1 行も無い。
   ダーティ通知は決まった —— `mc-worldgen` の `ChunkStore.subscribeDirty` である
   （plan.md §3.8 は mc-sim の API としているが、フラグを持つのは §3.7 により
   worldgen 側で、sim 経由にすると毎フレーム全チャンクのポーリングになる）。
   §2.1 に `render → worldgen` のエッジは既にあるので、購読に新しい依存は要らない。
5. `domain/kernel-vocabulary.ts` が削除され、`@nerima-games/mc-kernel` を
   `dependencies` から参照している（§5 参照）。

### 3.1 ブロッカーの連鎖

```
mc-worldgen の ChunkStore.subscribeDirty（決定済み）
  → mc-render の WorldRenderer が書ける
    → THREE.js アダプタが完成する
      → 内蔵 fixture ビューアが動く
        → 完了条件を満たす
          → APIロック 4 週間
            → 1.0.0
```

**最上流が mc-sim 側の未設計項目**である。mc-render 単独では先へ進めない部分がある。

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

## 5. `three` / `@types/three` をまだ入れていない理由

参照実装は `three@^0.170.0` / `@types/three@^0.170.0` を使う（`package.json:57,59`）。
plan.md §3.9 も THREE.js 描画一式を mc-render の責務としている。

**それでも `dependencies` に入れていない。** 現在のソースは THREE.js を 1 行も import していないので、
入れると「使っていないものへの依存」になる。加えて `@types/three` を devDependency に入れると
`tsconfig.base.json` の `types: []` / `lib: ["ES2024"]` との整合が問題になる。

**最初の THREE.js アダプタと同じコミットで、まとめて行う:**

1. `dependencies` に `three`、`devDependencies` に `@types/three`
2. `tsconfig.base.json` の `lib` に `"DOM"`（+ ワーカープール実装時に `"WebWorker"`）
   ——**ただしこれは自動ではない。改めて議論すること。**
   `window` 入力アダプタは `"DOM"` **無しで**入った（[design-notes.md](./design-notes.md) DN-15）:
   使う DOM メンバが 8 個だったので `application/dom-surface.ts` に構造的な型として書いた。
   THREE のクラス階層はその手が効く大きさではないので、おそらく `"DOM"` が要る。
   要ると判断した場合、**それは `environment: 'node'` で検査できる範囲が縮むということ**であり、
   縮む範囲を測ってから入れること
3. `types` に `"three"` は不要（`three` は自前の型を持たないが `@types/three` が
   `three` モジュールの型宣言を提供するため、`import` すれば解決される）
4. `vitest.config.ts` の `coverage.include` の見直し（GPU 依存コードは Node 計測から漏れる。
   [testing.md](./testing.md) §6）

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

**APIロックの diff チェックはこの表から外れた。** 完了条件を待たずに済ませてあり、
`pnpm api:check` が `pnpm verify` の `check:deps` と `test` の間で、また CI の
`API lock` ステップとして走る（[public-api.md](./public-api.md) §8）。
採用した生成器は declaration emit をメモリ上で走らせるので、上の「ビルド」行が
埋まるのを待つ必要が無かった。

**mc-render 固有の追加項目**: テクスチャアセットの同梱（plan.md §5.3
「アセットは消費者に同梱（テクスチャ→render、音声→audio）」）。
`files` にアセットディレクトリを含め、バンドラがそれをどう解決するかを決める必要がある。
現在の `files` にはアセット項目が無い。

## 8. 依存の固定

| 依存 | 現在 | 方針 |
| --- | --- | --- |
| `effect` | `^3.20.0` | 16 リポジトリで**同一メジャーに揃える**。Context / Layer の型が跨るため、メジャーが混ざると合成できない |
| `@nerima-games/*` | 未宣言 | publish 後は**厳密ピン**（`0.3.1` のように範囲なし）。plan.md の bottom-up publish-then-pin |
| `three` / `@types/three` | **未宣言** | §5。アダプタと同時に `^0.170.0` 起点で追加。**両者のバージョンを一致させる** |
| `typescript` / `vitest` / `oxlint` | `^` 付き | ツールチェーンは揃えるが厳密ピンはしない |
| `packageManager` | `pnpm@9.15.0` | 16 リポジトリで同一 |

`engines.node` は `>=22.0.0`。`flake.nix` の devShell が `nodejs_22` を入れる。
