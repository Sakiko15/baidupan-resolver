# 百度网盘解析工具 - 说明文档

## 一、注意事项

1. 不能直接使用别人的分享链接，需要先转存到自己的网盘再分享。
2. 只能分享文件，不能带文件夹（子目录内容会被忽略）。
3. 解析接口为第三方提供，无法保证长期稳定。

## 二、API 接口说明

### 2.1 获取分享资源信息

- **接口地址**：`http://mxd.indevs.in/api/dupansi`
- **请求方式**：`POST`

**请求体（JSON）：**

| 字段 | 说明 |
|------|------|
| `sign` | 长度 32 的随机字符串 |
| `site` | 主机名（即 `location.hostname`） |
| `surl` | 分享资源的短链标识 |
| `pwd`  | 提取码（无则留空） |

**请求示例：**

```json
{
  "sign": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "site": "example.com",
  "surl": "1xxxxx",
  "pwd": "abcd"
}
```

**响应体（JSON）：**

| 字段 | 说明 |
|------|------|
| `code`  | 状态码，`0` 表示成功 |
| `share` | 分享信息，包含 `uid`（分享者）、`sid`（分享资源 ID） |
| `list`  | 文件信息列表，每项含 `fid`（文件 ID）、`name`（文件名）、`size`（文件大小） |

**响应示例：**

```json
{
  "code": 0,
  "share": {
    "uid": "123456",
    "sid": "789012"
  },
  "list": [
    { "fid": "001", "name": "视频.mp4", "size": "1024" },
    { "fid": "002", "name": "文档.pdf", "size": "256" }
  ]
}
```

> **补充说明：**
> - 仅读取分享资源中的文件，忽略所有子目录的内容。
> - 解析服务端将 `sign` 和 `uid` 临时绑定，每小时刷新解除绑定。

### 2.2 获取文件直链

- **接口地址**：`http://mxd.index.in/api/dupan`
- **请求方式**：`POST`

**请求体（JSON）：**

| 字段 | 说明 |
|------|------|
| `sign` | 长度 32 的随机字符串 |
| `site` | 主机名（即 `location.hostname`） |
| `surl` | 分享资源的短链标识 |
| `pwd`  | 提取码 |
| `uid`  | 分享者 ID |
| `sid`  | 分享资源 ID |
| `fid`  | 目标文件 ID |

**请求示例：**

```json
{
  "sign": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "site": "example.com",
  "surl": "1xxxxx",
  "pwd": "abcd",
  "uid": "123456",
  "sid": "789012",
  "fid": "001"
}
```

**响应体（JSON）：**

| 字段 | 说明 |
|------|------|
| `code`      | 状态码，`0` 表示成功 |
| `data.url`  | 直链地址数组，元素为下载链接 |
| `data.info` | 文件信息，包含 `out`（文件名）、`user-agent`（请求所需 User-Agent） |

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "url": [ "https://example.com/dl/xxxx" ],
    "info": {
      "out": "视频.mp4",
      "user-agent": "netdisk"
    }
  }
}
```

## 三、调用流程

**第一步：调用 `/api/dupansi` 获取分享信息**

传入 `sign`、`site`、`surl`、`pwd`，得到 `uid`、`sid` 和文件列表。

**第二步：调用 `/api/dupan` 获取直链**

在上一步参数基础上，补充 `uid`、`sid` 和要下载的 `fid`，得到直链地址与下载所需信息。

**第三步：使用直链下载**

将 `data.url` 作为下载地址，配合 `data.info` 中的 `user-agent` 发起下载请求。

## 四、错误处理

当 `code` 不等于 `0` 时表示请求失败，常见原因：

- 分享链接已失效或被删除
- 提取码输入错误
- `sign` 与 `uid` 已经存在绑定，不匹配当前组合
- 解析接口服务异常
