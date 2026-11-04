import { Eye as ViewIcon, Pencil as EditIcon, Trash2 as DeleteIcon } from "lucide-react";
import type { LucideProps } from "lucide-react";

export function Eye(props: LucideProps) { return <ViewIcon aria-hidden="true" data-stockflow-action="view" {...props} />; }
export function Pencil(props: LucideProps) { return <EditIcon aria-hidden="true" data-stockflow-action="edit" {...props} />; }
export function Edit3(props: LucideProps) { return <EditIcon aria-hidden="true" data-stockflow-action="edit" {...props} />; }
export function Trash2(props: LucideProps) { return <DeleteIcon aria-hidden="true" data-stockflow-action="delete" {...props} />; }
