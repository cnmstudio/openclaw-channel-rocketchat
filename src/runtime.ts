// RocketChat 运行时管理

let runtime: any;

export function setRocketChatRuntime(rt: any): void {
  runtime = rt;
}

export function getRocketChatRuntime(): any {
  return runtime;
}