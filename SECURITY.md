# Security Policy

## Supported version

安全修复优先应用于最新版本。

## Reporting a vulnerability

请不要在公开 Issue 中披露未修复的安全问题。通过 GitHub 仓库所有者公开的私密联系方式，或 GitHub Security Advisory 的 “Report a vulnerability” 功能提交报告。请包含受影响版本、复现步骤、影响和建议修复方式。

本项目只应监听本机回环地址。不要将桥接端口暴露到局域网或公网，也不要提交 `.runtime/connection.json`。如果怀疑令牌泄露，停止桥接进程并重新启动，以生成新的控制令牌和配对码。
