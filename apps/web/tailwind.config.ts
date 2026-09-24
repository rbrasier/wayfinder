import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { "2xl": "1280px" },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-figtree)", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "'Courier New'", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // The Wayfinder ramp, so chrome written after the design refresh
        // references a token rather than another hex literal.
        wf: {
          bg: "var(--bg)",
          rail: "var(--bg2)",
          inset: "var(--bg3)",
          surface: "var(--surface)",
          line: "var(--wf-border)",
          "line-strong": "var(--border-strong)",
          "line-dashed": "var(--border-dashed)",
          text: "var(--wf-text)",
          "text-2": "var(--text2)",
          "text-3": "var(--text3)",
          "text-4": "var(--text4)",
          rule: "var(--rule)",
          dot: "var(--dot)",
          primary: "var(--wf-primary)",
          "primary-hover": "var(--primary-hover)",
          "primary-contrast": "var(--primary-contrast)",
          "primary-light": "var(--primary-light)",
          "primary-dim": "var(--primary-dim)",
          success: "var(--success)",
          "success-bg": "var(--success-bg)",
          "success-line": "var(--success-border)",
          warning: "var(--warning)",
          "warning-bg": "var(--warning-bg)",
          "warning-line": "var(--warning-border)",
          rose: "var(--rose)",
          "rose-bg": "var(--rose-bg)",
          teal: "var(--teal)",
          "teal-bg": "var(--teal-bg)",
          purple: "var(--purple)",
          "purple-light": "var(--purple-light)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        wf: "var(--radius)",
        "wf-sm": "var(--radius-sm)",
        "wf-lg": "var(--radius-lg)",
        "wf-xl": "var(--radius-xl)",
      },
      boxShadow: {
        wf: "var(--sh)",
        "wf-md": "var(--sh-md)",
        "wf-xl": "var(--sh-xl)",
      },
    },
  },
  plugins: [animate],
};

export default config;
