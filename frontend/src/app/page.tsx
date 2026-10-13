import HomeClient from "./HomeClient";

// The dashboard is an authenticated, fully interactive client application.
// Opt this route out of server-side instant-navigation validation explicitly.
export const instant = false;

export default function HomePage() {
  return <HomeClient />;
}
