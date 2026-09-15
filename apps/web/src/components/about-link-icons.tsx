import { Book, Bug, Github, HelpCircle, Link2, Mail, MessageSquare, Shield } from "lucide-react";
import type { AboutLinkIcon } from "@wayfinder/domain";

// The icon name crosses the wire as a string from admin_system_settings; this is
// the only place it becomes a component. Every key of AboutLinkIcon must appear
// here — the Record type makes a missing one a compile error.
export const ABOUT_LINK_ICON_COMPONENTS: Record<AboutLinkIcon, React.ElementType> = {
  link: Link2,
  github: Github,
  book: Book,
  mail: Mail,
  message: MessageSquare,
  help: HelpCircle,
  bug: Bug,
  shield: Shield,
};

export const ABOUT_LINK_ICON_LABELS: Record<AboutLinkIcon, string> = {
  link: "Link",
  github: "GitHub",
  book: "Documentation",
  mail: "Email",
  message: "Message",
  help: "Help",
  bug: "Bug",
  shield: "Security",
};
