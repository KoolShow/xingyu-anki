# xingyu-anki

从 [windlandneko/xingyu](https://github.com/windlandneko/xingyu) 生成 Anki 卡包。

原作：《外星来信》（Message From Aliens）。

## 用法

```sh
git submodule update --init
npm run deck
```

可选存档：

```sh
node --experimental-strip-types src/cli.ts --save alienmessage1.sav
```

网页入口：`npm run build` 后用 HTTP 服务打开 `index.html`。

## 授权

非官方同人作品，仅限个人非商业使用。字体与翻译归 windlandneko，字形版权归 Artless Games。
