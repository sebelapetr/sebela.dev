// Framework tooling of the package itself: a configuration file at the package root may read a
// private schema file of its own package, because nothing outside the package can import it.
import { profileTable } from "./src/modules/profile/schema.js";

export default { schema: profileTable.name };
