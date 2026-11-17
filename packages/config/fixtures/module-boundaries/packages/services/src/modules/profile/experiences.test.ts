// A colocated test imports a private file of its own module.
import { experienceTitles } from "./experiences.js";

export const titles = experienceTitles();
