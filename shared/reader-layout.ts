export const paneDefaults = {leftWidth:240,rightWidth:360,documentShare:40,readerShare:60,headerHeight:64,toolbarHeight:56,composerHeight:64};
export type PaneLayout = typeof paneDefaults;
export const paneBounds: Record<keyof PaneLayout,[number,number]> = {
  leftWidth:[180,500],rightWidth:[260,700],documentShare:[15,80],readerShare:[25,80],headerHeight:[48,96],toolbarHeight:[56,140],composerHeight:[44,240],
};
export function validateLayoutPatch(input: unknown): Partial<PaneLayout> {
  if (!input || typeof input!=="object" || Array.isArray(input) || !Object.keys(input).length) throw new Error("缺少布局参数");
  const patch: Partial<PaneLayout>={};
  for (const [key,value] of Object.entries(input)) {
    if (!Object.hasOwn(paneBounds,key)) throw new Error(`未知布局参数：${key}`);
    const name=key as keyof PaneLayout;const [min,max]=paneBounds[name];
    if (typeof value!=="number" || !Number.isFinite(value) || value<min || value>max) throw new Error(`${key} 范围为 ${min}–${max}`);
    patch[name]=value;
  }
  return patch;
}
export const paneLayoutSchema = {type:"object",minProperties:1,additionalProperties:false,properties:Object.fromEntries(
  Object.entries(paneBounds).map(([key,[minimum,maximum]])=>[key,{type:"number",minimum,maximum}]))};
