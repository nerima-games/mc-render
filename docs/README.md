# mc-render ドキュメント索引

`@nerima-games/mc-render` の実装情報一式。上位仕様は plan.md（**非公開**）、
参照実装は `<reference-impl>`（凍結・テストオラクル扱い）。
本ディレクトリ内の参照実装パスはすべて ts-minecraft リポジトリルート相対で書く。

## 表記

| 表記 | 意味 |
| --- | --- |
| `<reference-impl>` | **参照実装のチェックアウトのルート**。凍結された `takeokunn/ts-minecraft` の作業コピーを指す。本ドキュメント群では `<reference-impl>/packages/…` の形か、単に `packages/…`（同じくルート相対）で引用する。手元のどこに clone してあっても読み替えられるようにするためのプレースホルダである |
| plan.md | リポジトリ構成仕様書（16 リポジトリ、確定済み）。**非公開**であり、公開読者は開けない。だから本ドキュメント群は「plan.md を読まなくても追える」ことを要件にしている —— plan.md の主張を引くときは必ず原文を引用し、参照実装での裏づけを file:line で添える |
| `nerima-games/<repo>` | 同 org の兄弟リポジトリ。リンクは GitHub の URL で張る |

## このリポジトリを一言でいうと

**THREE.js 描画一式と、実行時入力サービス。**

一見無関係な 2 つが同居しているのには理由がある。plan.md §2.3-2 が明示するとおり、
mc-playground-kit は devDependency 専用で出荷ビルドに入らないため、**入力を kit に置くと
本番ゲームから入力処理が丸ごと消える**。入力もブラウザプラットフォームの関心事であり、
それを所有しているのがこのリポジトリである。

そして**このリポジトリはカメラの正ではない**。`CameraPoseSnapshot` の正は mc-sim が持ち、
ここはミラーするだけ。逆向きの依存は循環になり `pnpm check:deps` が落とす。

## 読む順序

| 文書 | 内容 | 誰が読むか |
| --- | --- | --- |
| [architecture.md](./architecture.md) | 4階層アーキテクチャ、依存グラフ全体、本リポジトリの位置、名詞/動詞ルール、kit の devDependency 専用規則、stage 全順序の所有者 | 最初に全員 |
| [responsibility.md](./responsibility.md) | 責務 plan.md §3.9、**非スコープの明示**、親と子 | 機能を足す前に |
| [public-api.md](./public-api.md) | 公開すべきAPI。参照実装の実コードと突き合わせて検証済み | API を触る人 |
| [design-notes.md](./design-notes.md) | 設計注意の全項目。参照実装の file:line 証跡つき。**各項目は書くべき回帰テスト名として表現している** | 実装する人（必読） |
| [porting.md](./porting.md) | 移植元パスと**実測 LOC** | 移植する人 |
| [testing.md](./testing.md) | 検証要件、完了条件、カバレッジゲート | テストを書く人 |
| [versioning.md](./versioning.md) | 0.x → 1.0.0、GitHub Packages、`three` の追加時期 | リリースする人 |

## いま何が入っているか

**pre-audit first cut（叩き台）。しかも THREE.js が 1 行も入っていない。**

ドメインはすべて**純粋**である。ポストFXチェーンは配列、マテリアル方針は述語、
入力バインディングは表、スクラッチバッファはただの `Map`。WebGL は無い。
これは手抜きではなく設計判断で、理由は [testing.md](./testing.md) §3 にある——
順序規則やイベント遮蔽規則を **`environment: 'node'` の単体テストで固定できる**ようにするため。

`window` 入力アダプタは入ったが、**`lib` の `"DOM"` は入れていない**。
触る DOM メンバは 8 個で、`application/dom-surface.ts` に構造的な型として書いてある
（[design-notes.md](./design-notes.md) DN-15）。

| 領域 | 実装 | 設計注意 |
| --- | --- | --- |
| ポストFXの確定順序 | `domain/post-processing.ts` | DN-01 |
| `forceSinglePass` 規則 | `domain/material-policy.ts` | DN-02 |
| フレーム毎スクラッチの再利用 | `domain/frame-scratch.ts` | DN-03 |
| 入力の window/document 遮蔽と Escape 単一所有 | `domain/input-bindings.ts` / `application/input-service.ts` | DN-04 / DN-05 |
| クリック・ホイール・ポインタロック要求 | 同上 | DN-12 / DN-13 / DN-14 |
| `window` 入力アダプタ（登録 / 解除 / 変換 / ロック要求） | `application/browser-input-adapter.ts` / `application/dom-surface.ts` | DN-04 / DN-12 / DN-13 / DN-14 / DN-15 |
| カメラのミラー（書き戻し無し） | `domain/camera-mirror.ts` | DN-06 |

まだ無いもの: **THREE.js アダプタ一式**（`WorldRenderer` / マテリアル / パーティクル / 水面 /
テクスチャ）、ゲームパッド / タッチ入力、ワーカープール実装、内蔵 fixture ビューア、
グラフィックス品質プリセットの残り半分（レンダースケール・影解像度・視界距離）。
`three` / `@types/three` は**まだ依存に入れていない**（[versioning.md](./versioning.md) §5）。
