"use client";

import type { ReactNode } from "react";
import { Boxes, Package, Ruler, Tag, Truck, UserRound, Users, Warehouse } from "lucide-react";

type MasterModuleKind = "categories" | "brands" | "units" | "products" | "warehouses" | "staff" | "customers" | "suppliers";

const modules: Record<MasterModuleKind, { title: string; description: string; accent: string; icon: typeof Boxes; eyebrow: string; detail: string }> = {
  categories: { title: "Category Management", description: "Build a clean taxonomy for fast product discovery.", accent: "from-blue-700 via-blue-600 to-indigo-500", icon: Tag, eyebrow: "Catalog architecture", detail: "GROUP · FILTER · DISCOVER" },
  brands: { title: "Brand Gallery", description: "Curate product identities and keep naming consistent.", accent: "from-violet-700 via-fuchsia-600 to-pink-500", icon: Boxes, eyebrow: "Identity library", detail: "BRAND · STORY · STATUS" },
  units: { title: "Measurement Studio", description: "Standardize the units used by purchasing and stock.", accent: "from-amber-500 via-orange-500 to-red-500", icon: Ruler, eyebrow: "Quantity standards", detail: "PCS · BOX · KG · L" },
  products: { title: "Product Command Center", description: "Connect SKU, barcode, classification and stock rules.", accent: "from-emerald-700 via-teal-600 to-cyan-500", icon: Package, eyebrow: "Catalog operations", detail: "SKU · STOCK · ALERT" },
  warehouses: { title: "Warehouse Operations", description: "Manage locations and prepare physical stock counts.", accent: "from-cyan-700 via-sky-600 to-blue-500", icon: Warehouse, eyebrow: "Storage network", detail: "LOCATE · COUNT · CONTROL" },
  staff: { title: "Operations Team", description: "Connect people, responsibilities and warehouse assignments.", accent: "from-indigo-800 via-indigo-600 to-blue-500", icon: Users, eyebrow: "People directory", detail: "TEAM · ROLE · LOCATION" },
  customers: { title: "Customer Workspace", description: "Maintain sales contacts individually or import them in bulk.", accent: "from-rose-700 via-pink-600 to-fuchsia-500", icon: UserRound, eyebrow: "Sales relationships", detail: "PROFILE · IMPORT · SERVE" },
  suppliers: { title: "Supplier Network", description: "Organize purchasing partners and contact readiness.", accent: "from-orange-700 via-red-600 to-rose-500", icon: Truck, eyebrow: "Procurement partners", detail: "SOURCE · CONTACT · SUPPLY" },
};

export default function MasterModuleFrame({ kind, children }: { kind: MasterModuleKind; children: ReactNode }) {
  const config = modules[kind];
  const Icon = config.icon;
  return <section className="space-y-5"><div className={`relative min-h-44 overflow-hidden rounded-3xl bg-gradient-to-br ${config.accent} p-6 text-white shadow-lg sm:p-8`}>
    {kind === "categories" && <div className="absolute right-8 top-7 flex rotate-3 flex-wrap gap-2 opacity-30">{["Hardware", "Food", "Office", "Tools"].map((label) => <span key={label} className="rounded-full border border-white px-3 py-1 text-xs">{label}</span>)}</div>}
    {kind === "brands" && <><div className="absolute -right-8 -top-12 h-44 w-44 rounded-full border-[28px] border-white/10" /><div className="absolute right-36 top-10 h-16 w-16 rounded-full bg-white/10" /></>}
    {kind === "units" && <div className="absolute inset-y-0 right-0 w-2/5 opacity-20" style={{ backgroundImage: "linear-gradient(90deg,white 1px,transparent 1px),linear-gradient(white 1px,transparent 1px)", backgroundSize: "24px 24px" }} />}
    {kind === "products" && <div className="absolute right-8 top-7 space-y-2 opacity-25">{[82, 64, 94, 48].map((width) => <div key={width} className="h-3 rounded-full bg-white" style={{ width }} />)}</div>}
    {kind === "warehouses" && <div className="absolute bottom-0 right-5 flex items-end gap-2 opacity-20">{[70, 105, 84, 125].map((height) => <div key={height} className="w-12 border-2 border-b-0 border-white" style={{ height }} />)}</div>}
    {kind === "staff" && <div className="absolute right-10 top-8 grid grid-cols-3 gap-3 opacity-25">{Array.from({ length: 9 }, (_, index) => <span key={index} className="h-8 w-8 rounded-full bg-white" />)}</div>}
    {kind === "customers" && <div className="absolute -bottom-24 right-6 h-52 w-80 rounded-[50%] border-[24px] border-white/10" />}
    {kind === "suppliers" && <div className="absolute right-8 top-8 flex items-center opacity-25"><span className="h-4 w-4 rounded-full bg-white" /><span className="h-0.5 w-32 bg-white" /><span className="h-10 w-10 rounded-xl border-2 border-white" /></div>}
    <div className="relative flex min-h-28 flex-wrap items-end justify-between gap-5"><div className="flex items-start gap-4"><div className="rounded-2xl bg-white/15 p-3.5 shadow-inner backdrop-blur"><Icon size={28} /></div><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">{config.eyebrow}</p><h2 className="mt-2 text-2xl font-bold sm:text-3xl">{config.title}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-white/80">{config.description}</p></div></div><span className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-[10px] font-bold tracking-[0.18em] backdrop-blur">{config.detail}</span></div>
  </div><div>{children}</div></section>;
}

export type { MasterModuleKind };
