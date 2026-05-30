import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import "./custom.css";

import Hero from "./components/Hero.vue";
import HomeShowcase from "./components/HomeShowcase.vue";
import CodeBlock from "./components/CodeBlock.vue";
import LifecycleStepper from "./components/LifecycleStepper.vue";
import ResumeSimulator from "./components/ResumeSimulator.vue";
import SemaphoreViz from "./components/SemaphoreViz.vue";
import ParallelPipeline from "./components/ParallelPipeline.vue";
import EventStream from "./components/EventStream.vue";
import SandboxWidget from "./components/SandboxWidget.vue";
import WorkflowTui from "./components/WorkflowTui.vue";

import RoughDiagram from "./components/rough/RoughDiagram.vue";
import RoughCanvas from "./components/rough/RoughCanvas.vue";
import RoughBox from "./components/rough/RoughBox.vue";
import RoughArrow from "./components/rough/RoughArrow.vue";
import RoughText from "./components/rough/RoughText.vue";
import RoughBracket from "./components/rough/RoughBracket.vue";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("Hero", Hero);
    app.component("HomeShowcase", HomeShowcase);
    app.component("CodeBlock", CodeBlock);
    app.component("LifecycleStepper", LifecycleStepper);
    app.component("ResumeSimulator", ResumeSimulator);
    app.component("SemaphoreViz", SemaphoreViz);
    app.component("ParallelPipeline", ParallelPipeline);
    app.component("EventStream", EventStream);
    app.component("SandboxWidget", SandboxWidget);
    app.component("WorkflowTui", WorkflowTui);
    app.component("RoughDiagram", RoughDiagram);
    app.component("RoughCanvas", RoughCanvas);
    app.component("RoughBox", RoughBox);
    app.component("RoughArrow", RoughArrow);
    app.component("RoughText", RoughText);
    app.component("RoughBracket", RoughBracket);
  },
} satisfies Theme;
