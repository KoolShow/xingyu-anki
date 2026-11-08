# xingyu-anki

从 [windlandneko/xingyu](https://github.com/windlandneko/xingyu) 生成 Anki 卡包。

原作：[《外星来信》（Message From Aliens）](https://store.steampowered.com/app/1858720/Message_From_Aliens/)。

建议完成此游戏的全部字典后再使用，当心剧透。禁止二次分发产物！

## 用法

使用 [Anki](https://apps.ankiweb.net/) 导入卡包。

## 构建

```sh
git submodule update --init
npm run deck
```

可选存档：

```sh
node --experimental-strip-types src/cli.ts --save alienmessage1.sav
```

可选外部数据（词性、字形组成、例句）：

```sh
node --experimental-strip-types src/cli.ts --external
```

网页入口：`npm run build` 后用 HTTP 服务打开 `index.html`，可勾选“使用外部数据”。

## 授权

非官方同人作品，仅限个人非商业使用。字体与翻译归 windlandneko，字形版权归 Artless Games。
