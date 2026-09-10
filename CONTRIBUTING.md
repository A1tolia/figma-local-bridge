# Contributing

感谢你改进 Figma Local Bridge。

## 开发环境

- Node.js 22 或更高版本
- Figma 桌面应用（真实插件联调时需要）
- Windows PowerShell（安装脚本测试时需要）

克隆仓库后无需安装第三方运行依赖。运行测试：

```powershell
npm test
```

## 提交改动

1. 为问题或功能创建清晰、范围有限的分支。
2. 修改行为时补充能验证该行为的测试。
3. 运行 `npm test`，并在涉及 Figma Plugin API 时完成真实 Figma 联调。
4. Pull request 中说明问题、最终行为、验证方式和仍未验证的边界。

不要提交 `.runtime/`、访问令牌、配对码、用户设计文件或未经许可的素材。文档与测试输出中的 Figma 内容必须使用自有或可公开分发的示例。
