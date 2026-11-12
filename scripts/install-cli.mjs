#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import process from "node:process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["link"], {stdio:"inherit"});
if (result.error) { console.error(`无法安装 lita：${result.error.message}`); process.exit(1); }
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("已安装 lita。运行 `lita --help` 查看命令。");
