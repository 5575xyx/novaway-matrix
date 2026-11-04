import "./index.css"
import { Title, Meta } from "@solidjs/meta"
//import { HttpHeader } from "@solidjs/start"
import video from "../asset/lander/novaway-min.mp4"
import videoPoster from "../asset/lander/novaway-poster.png"
import { IconCopy, IconCheck } from "../component/icon"
import { createAsync } from "@solidjs/router"
import { EmailSignup } from "~/component/email-signup"
import { Tabs } from "@kobalte/core/tabs"
import { Faq } from "~/component/faq"
import { Header } from "~/component/header"
import { Footer } from "~/component/footer"
import { Legal } from "~/component/legal"
import { github } from "~/lib/github"
import { config } from "~/config"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { LocaleLinks } from "~/component/locale-links"

function CopyStatus() {
  return (
    <div data-component="copy-status">
      <IconCopy data-slot="copy" />
      <IconCheck data-slot="check" />
    </div>
  )
}

export default function Home() {
  const i18n = useI18n()
  const language = useLanguage()
  const _githubData = createAsync(() => github())
  const handleCopyClick = (event: Event) => {
    const button = event.currentTarget as HTMLButtonElement
    const text = button.textContent
    if (text) {
      void navigator.clipboard.writeText(text)
      button.setAttribute("data-copied", "")
      setTimeout(() => {
        button.removeAttribute("data-copied")
      }, 1500)
    }
  }

  return (
    <main data-page="novaway">
      {/*<HttpHeader name="Cache-Control" value="public, max-age=1, s-maxage=3600, stale-while-revalidate=86400" />*/}
      <Title>{i18n.t("home.title")}</Title>
      <LocaleLinks path="/" />
      <Meta property="og:image" content="/social-share.png" />
      <Meta name="twitter:image" content="/social-share.png" />
      <div data-component="container">
        <Header />

        <div data-component="content">
          <section data-component="hero">
            <div data-component="desktop-app-banner">
              <span data-slot="badge">{i18n.t("home.banner.badge")}</span>
              <div data-slot="content">
                <span data-slot="text">
                  {i18n.t("home.banner.text")}
                  <span data-slot="platforms"> {i18n.t("home.banner.platforms")}</span>.
                </span>
                <a href={language.route("/download")} data-slot="link">
                  {i18n.t("home.banner.downloadNow")}
                </a>
                <a href={language.route("/download")} data-slot="link-mobile">
                  {i18n.t("home.banner.downloadBetaNow")}
                </a>
              </div>
            </div>

            <div data-slot="hero-copy">
              {/*<a data-slot="releases"*/}
              {/*   href={release()?.url ?? `${config.github.repoUrl}/releases`}*/}
              {/*   target="_blank">*/}
              {/*  What’s new in {release()?.name ?? "the latest release"}*/}
              {/*</a>*/}
              <h1>{i18n.t("home.hero.title")}</h1>
              <p>
                {i18n.t("home.hero.subtitle.a")} <span data-slot="br"></span>
                {i18n.t("home.hero.subtitle.b")}
              </p>
            </div>
            <div data-slot="installation">
              <Tabs
                as="section"
                aria-label={i18n.t("home.install.ariaLabel")}
                class="tabs"
                data-component="tabs"
                data-active="curl"
                defaultValue="curl"
              >
                <Tabs.List data-slot="tablist">
                  <Tabs.Trigger value="curl" data-slot="tab">
                    curl
                  </Tabs.Trigger>
                  <Tabs.Trigger value="npm" data-slot="tab">
                    npm
                  </Tabs.Trigger>
                  <Tabs.Trigger value="bun" data-slot="tab">
                    bun
                  </Tabs.Trigger>
                  <Tabs.Indicator />
                </Tabs.List>
                <div data-slot="panels">
                  <Tabs.Content as="pre" data-slot="panel" value="curl">
                    <button data-copy data-slot="command" onClick={handleCopyClick}>
                      <span data-slot="command-script">
                        <span>curl -fsSL </span>
                        <span data-slot="protocol">https://</span>
                        <span data-slot="highlight">novaway.ai/install</span>
                        <span> | bash</span>
                      </span>
                      <CopyStatus />
                    </button>
                  </Tabs.Content>
                  <Tabs.Content as="pre" data-slot="panel" value="npm">
                    <button data-copy data-slot="command" onClick={handleCopyClick}>
                      <span>
                        <span data-slot="protocol">npm i -g </span>
                        <span data-slot="highlight">xymt-novaway</span>
                      </span>
                      <CopyStatus />
                    </button>
                  </Tabs.Content>
                  <Tabs.Content as="pre" data-slot="panel" value="bun">
                    <button data-copy data-slot="command" onClick={handleCopyClick}>
                      <span>
                        <span data-slot="protocol">bun add -g </span>
                        <span data-slot="highlight">xymt-novaway</span>
                      </span>
                      <CopyStatus />
                    </button>
                  </Tabs.Content>
                </div>
              </Tabs>
            </div>
          </section>

          <section data-component="video">
            <video src={video} autoplay playsinline loop muted preload="auto" poster={videoPoster}>
              {i18n.t("common.videoUnsupported")}
            </video>
          </section>

          <section data-component="what">
            <div data-slot="section-title">
              <h3>{i18n.t("home.what.title")}</h3>
              <p>{i18n.t("home.what.body")}</p>
            </div>
            <ul>
              <li>
                <span>[*]</span>
                <div>
                  <strong>{i18n.t("home.what.lsp.title")}</strong> {i18n.t("home.what.lsp.body")}
                </div>
              </li>
              <li>
                <span>[*]</span>
                <div>
                  <strong>{i18n.t("home.what.multiSession.title")}</strong> {i18n.t("home.what.multiSession.body")}
                </div>
              </li>
              <li>
                <span>[*]</span>
                <div>
                  <strong>{i18n.t("home.what.shareLinks.title")}</strong> {i18n.t("home.what.shareLinks.body")}
                </div>
              </li>
              <li>
                <span>[*]</span>
                <div>
                  <strong>{i18n.t("home.what.copilot.title")}</strong> {i18n.t("home.what.copilot.body")}
                </div>
              </li>
              <li>
                <span>[*]</span>
                <div>
                  <strong>{i18n.t("home.what.chatgptPlus.title")}</strong> {i18n.t("home.what.chatgptPlus.body")}
                </div>
              </li>
              <li>
                <span>[*]</span>
                <div>
                  <strong>{i18n.t("home.what.anyModel.title")}</strong> {i18n.t("home.what.anyModel.body")}
                </div>
              </li>
              <li>
                <span>[*]</span>
                <div>
                  <strong>{i18n.t("home.what.anyEditor.title")}</strong> {i18n.t("home.what.anyEditor.body")}
                </div>
              </li>
            </ul>
            <a href={language.route("/docs")}>
              <span>{i18n.t("home.what.readDocs")} </span>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M6.5 12L17 12M13 16.5L17.5 12L13 7.5"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="square"
                />
              </svg>
            </a>
          </section>

          <section data-component="growth">
            <div data-slot="section-title">
              <h3>{i18n.t("home.growth.title")}</h3>
              <div>
                <span>[*]</span>
                <p
                  innerHTML={i18n.t("home.growth.body", {
                    stars: config.github.starsFormatted.full,
                    contributors: config.stats.contributors,
                    commits: config.stats.commits,
                    monthlyUsers: config.stats.monthlyUsers,
                  })}
                />
              </div>

              <div data-component="growth-stats">
                <div data-component="growth-stat">
                  <div data-component="stat-illustration">
                    <svg width="205" height="264" viewBox="0 0 205 264" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <g opacity="0.5" clip-path="url(#clip0_236_15902)">
                        <mask
                          id="mask0_236_15902"
                          style="mask-type:alpha"
                          maskUnits="userSpaceOnUse"
                          x="0"
                          y="0"
                          width="205"
                          height="264"
                        >
                          <path
                            d="M27.2119 253.122L0 264H205V0L192.109 17.8482L175.297 43.8089L152.877 59.95L137.902 77.6701L126.989 87.3251L118.603 106.449L103.114 123.643L93.359 141.714L84.2883 160.311L78.7262 177.329L67.773 193.997L62.8098 212.068L57.3332 231.191L42.5292 243.824L27.2119 253.122Z"
                            fill="url(#paint0_linear_236_15902)"
                          />
                        </mask>
                        <g mask="url(#mask0_236_15902)">
                          <path
                            d="M150.932 -135.014L-251.766 267.684M154.115 -131.832L-248.582 270.865M157.295 -128.65L-245.402 274.047M160.479 -125.469L-242.219 277.229M163.662 -122.287L-239.035 280.41M166.842 -119.105L-235.855 283.592M170.025 -115.924L-232.672 286.773M173.205 -112.742L-229.492 289.955M176.385 -109.561L-226.312 293.137M179.568 -106.377L-223.129 296.32M182.752 -103.193L-219.945 299.504M185.936 -100.012L-216.762 302.686M189.119 -96.8301L-213.578 305.867M192.295 -93.6484L-210.402 309.049M195.479 -90.4668L-207.219 312.23M198.662 -87.2852L-204.035 315.412M201.842 -84.1035L-200.855 318.594M205.025 -80.9219L-197.672 321.775M208.209 -77.7383L-194.488 324.959M211.389 -74.5586L-191.309 328.139M214.568 -71.375L-188.129 331.322M217.752 -68.1934L-184.945 334.504M220.936 -65.0117L-181.762 337.686M224.119 -61.8281L-178.578 340.869M227.303 -58.6465L-175.395 344.051M230.482 -55.4668L-172.215 347.23M233.662 -52.2832L-169.035 350.414M236.846 -49.0996L-165.852 353.598M240.025 -45.9199L-162.672 356.777M243.209 -42.7383L-159.488 359.959M246.393 -39.5547L-156.305 363.143M249.572 -36.375L-153.125 366.322M252.756 -33.1934L-149.941 369.504M255.936 -30.0098L-146.762 372.688M259.119 -26.8281L-143.578 375.869M262.303 -23.6465L-140.395 379.051M265.486 -20.4609L-137.211 382.236M268.666 -17.2812L-134.031 385.416M271.85 -14.0996L-130.848 388.598M275.029 -10.918L-127.668 391.779M278.209 -7.73633L-124.488 394.961M281.393 -4.55469L-121.305 398.143M284.576 -1.37305L-118.121 401.324M287.756 1.80859L-114.941 404.506M290.94 4.99023L-111.758 407.688M294.119 8.17383L-108.578 410.871M297.303 11.3574L-105.395 414.055M300.486 14.5391L-102.211 417.236M303.67 17.7207L-99.0273 420.418M306.85 20.9023L-95.8477 423.6M310.033 24.084L-92.6641 426.781M313.213 27.2656L-89.4844 429.963M316.393 30.4473L-86.3047 433.145M319.576 33.6289L-83.1211 436.326M322.76 36.8125L-79.9375 439.51M325.94 39.9941L-76.7578 442.691M329.123 43.1758L-73.5742 445.873M332.307 46.3574L-70.3906 449.055M335.486 49.541L-67.2109 452.238M338.67 52.7227L-64.0273 455.42M341.854 55.9043L-60.8438 458.602M345.033 59.0859L-57.6641 461.783M348.217 62.2676L-54.4805 464.965M351.397 65.4512L-51.3008 468.148M354.576 68.6328L-48.1211 471.33M357.76 71.8145L-44.9375 474.512M360.943 74.9961L-41.7539 477.693M364.123 78.1777L-38.5742 480.875M367.307 81.3594L-35.3906 484.057M370.49 84.541L-32.207 487.238M373.67 87.7246L-29.0273 490.422M376.854 90.9062L-25.8438 493.604M380.033 94.0859L-22.6641 496.783M383.217 97.2695L-19.4805 499.967M386.4 100.453L-16.2969 503.15M389.58 103.633L-13.1172 506.33M392.76 106.816L-9.9375 509.514"
                            stroke="#8E8B8B"
                          />
                        </g>
                        <path
                          d="M0 264L27.2119 253.122L42.5292 243.824L57.3332 231.191L62.8098 212.068L67.773 193.997L78.7262 177.329L84.2883 160.311L93.359 141.714L103.114 123.643L118.603 106.449L126.989 87.3251L137.902 77.6701L152.877 59.95L175.297 43.8089L192.109 17.8482L205 0"
                          stroke="#BCBBBB"
                        />
                      </g>
                      <defs>
                        <linearGradient
                          id="paint0_linear_236_15902"
                          x1="102.5"
                          y1="-34.8571"
                          x2="102.5"
                          y2="264"
                          gradientUnits="userSpaceOnUse"
                        >
                          <stop stop-color="#565656" />
                          <stop offset="1" stop-color="#F1F0F0" stop-opacity="0" />
                        </linearGradient>
                        <clipPath id="clip0_236_15902">
                          <rect width="205" height="264" fill="white" />
                        </clipPath>
                      </defs>
                    </svg>
                  </div>
                  <span>
                    <figure>{i18n.t("common.figure", { n: 1 })}</figure>{" "}
                    <strong>{config.github.starsFormatted.compact}</strong> {i18n.t("home.growth.githubStars")}
                  </span>
                </div>

                <div data-component="growth-stat">
                  <div data-component="stat-illustration">
                    <svg width="205" height="264" viewBox="0 0 205 264" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <g opacity="0.5" clip-path="url(#clip0_236_15557)">
                        <g clip-path="url(#clip1_236_15557)">
                          <rect opacity="0.81" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.46" x="14" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.86" x="28" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.08" x="42" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.23" x="56" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.9" x="70" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.59" x="84" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.8" x="98" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.21" x="112" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.22" x="126" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.62" x="140" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.41" x="154" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.22" x="168" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.25" x="182" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.34" x="196" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.84" y="14" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.79" x="14" y="14" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.49" x="28" y="14" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.49" x="42" y="14" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.05" x="56" y="14" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.59" x="70" y="14" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.44" x="84" y="14" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.21" x="98" y="14" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.53" x="112" y="14" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.81" x="126" y="14" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.24" x="140" y="14" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.61" x="154" y="14" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.14" x="168" y="14" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.26" x="182" y="14" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.8" x="196" y="14" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.02" y="28" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.69" x="14" y="28" width="6" height="6" fill="#CFCECD" />
                          <rect x="28" y="28" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.4" x="42" y="28" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.88" x="56" y="28" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.38" x="70" y="28" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.38" x="84" y="28" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.78" x="98" y="28" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.49" x="112" y="28" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.13" x="126" y="28" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.76" x="140" y="28" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.35" x="154" y="28" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.59" x="168" y="28" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.34" x="182" y="28" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.3" x="196" y="28" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.6" y="42" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.3" x="14" y="42" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.65" x="28" y="42" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.41" x="42" y="42" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.84" x="56" y="42" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.33" x="70" y="42" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.81" x="84" y="42" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.78" x="98" y="42" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.72" x="112" y="42" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.71" x="126" y="42" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.46" x="140" y="42" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.06" x="154" y="42" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.05" x="168" y="42" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.44" x="182" y="42" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.09" x="196" y="42" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.03" y="56" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.58" x="14" y="56" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.24" x="28" y="56" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.1" x="42" y="56" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.09" x="56" y="56" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.3" x="70" y="56" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.6" x="84" y="56" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.39" x="98" y="56" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.53" x="112" y="56" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.83" x="126" y="56" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.25" x="140" y="56" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.87" x="154" y="56" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.38" x="168" y="56" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.19" x="182" y="56" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.89" x="196" y="56" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.98" y="70" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.26" x="14" y="70" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.79" x="28" y="70" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.67" x="56" y="70" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.48" x="70" y="70" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.76" x="84" y="70" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.72" x="98" y="70" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.01" x="112" y="70" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.46" x="126" y="70" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.27" x="140" y="70" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.78" x="154" y="70" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.16" x="168" y="70" width="6" height="6" fill="#CFCECD" />
                          <rect x="182" y="70" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.86" x="196" y="70" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.18" y="84" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.04" x="14" y="84" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.61" x="28" y="84" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.47" x="42" y="84" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.81" x="56" y="84" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.98" x="70" y="84" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.3" x="84" y="84" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.1" x="98" y="84" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.42" x="112" y="84" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.66" x="126" y="84" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.68" x="140" y="84" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.35" x="154" y="84" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.6" x="168" y="84" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.95" x="182" y="84" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.05" x="196" y="84" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.77" y="98" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.06" x="14" y="98" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.45" x="28" y="98" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.73" x="42" y="98" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.21" x="70" y="98" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.18" x="84" y="98" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.92" x="98" y="98" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.26" x="112" y="98" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.21" x="126" y="98" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.27" x="140" y="98" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.84" x="154" y="98" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.74" x="168" y="98" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.53" x="182" y="98" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.9" x="196" y="98" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.32" y="112" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.75" x="14" y="112" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.69" x="28" y="112" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.66" x="42" y="112" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.93" x="56" y="112" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.32" x="70" y="112" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.52" x="84" y="112" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.02" x="98" y="112" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.88" x="126" y="112" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.12" x="140" y="112" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.93" x="154" y="112" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.79" x="168" y="112" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.24" x="182" y="112" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.64" x="196" y="112" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.57" y="126" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.6" x="14" y="126" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.05" x="28" y="126" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.28" x="42" y="126" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.21" x="56" y="126" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.93" x="70" y="126" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.63" x="84" y="126" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.58" x="98" y="126" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.64" x="112" y="126" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.74" x="126" y="126" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.74" x="140" y="126" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.1" x="154" y="126" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.93" x="168" y="126" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.43" x="182" y="126" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.45" x="196" y="126" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.77" y="140" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.78" x="14" y="140" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.18" x="28" y="140" width="6" height="6" fill="#DAD9D9" />
                          <rect x="42" y="140" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.39" x="56" y="140" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.53" x="70" y="140" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.06" x="84" y="140" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.81" x="98" y="140" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.49" x="112" y="140" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.45" x="126" y="140" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.37" x="140" y="140" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.58" x="154" y="140" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.8" x="168" y="140" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.35" x="182" y="140" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.73" x="196" y="140" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.92" y="154" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.32" x="14" y="154" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.3" x="28" y="154" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.03" x="42" y="154" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.65" x="56" y="154" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.66" x="70" y="154" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.83" x="84" y="154" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.52" x="98" y="154" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.82" x="112" y="154" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.95" x="126" y="154" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.89" x="140" y="154" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.2" x="154" y="154" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.61" x="168" y="154" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.34" x="196" y="154" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.9" y="168" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.99" x="14" y="168" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.49" x="28" y="168" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.84" x="42" y="168" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.67" x="56" y="168" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.92" x="70" y="168" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.79" x="84" y="168" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.8" x="98" y="168" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.74" x="112" y="168" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.38" x="126" y="168" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.56" x="140" y="168" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.7" x="154" y="168" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.47" x="168" y="168" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.92" x="182" y="168" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.19" x="196" y="168" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.12" y="182" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.16" x="14" y="182" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.98" x="28" y="182" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.6" x="42" y="182" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.15" x="56" y="182" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.17" x="70" y="182" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.26" x="84" y="182" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.3" x="98" y="182" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.12" x="112" y="182" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.31" x="126" y="182" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.62" x="140" y="182" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.74" x="154" y="182" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.8" x="168" y="182" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.89" x="182" y="182" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.75" x="196" y="182" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.1" y="196" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.11" x="14" y="196" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.79" x="28" y="196" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.69" x="42" y="196" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.39" x="56" y="196" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.31" x="70" y="196" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.33" x="84" y="196" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.2" x="98" y="196" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.21" x="112" y="196" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.02" x="126" y="196" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.82" x="140" y="196" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.28" x="154" y="196" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.19" x="168" y="196" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.97" x="182" y="196" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.45" x="196" y="196" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.88" y="210" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.58" x="14" y="210" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.53" x="28" y="210" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.89" x="42" y="210" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.38" x="56" y="210" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.73" x="70" y="210" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.87" x="84" y="210" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.35" x="98" y="210" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.61" x="112" y="210" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.8" x="126" y="210" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.87" x="140" y="210" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.77" x="154" y="210" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.94" x="168" y="210" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.59" x="182" y="210" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.37" x="196" y="210" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.7" y="224" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.72" x="14" y="224" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.95" x="28" y="224" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.26" x="42" y="224" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.68" x="56" y="224" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.55" x="70" y="224" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.2" x="84" y="224" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.63" x="98" y="224" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.5" x="112" y="224" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.79" x="126" y="224" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.02" x="140" y="224" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.17" x="154" y="224" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.99" x="168" y="224" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.82" x="182" y="224" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.28" x="196" y="224" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.76" y="238" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.39" x="14" y="238" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.14" x="28" y="238" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.17" x="42" y="238" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.37" x="56" y="238" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.13" x="70" y="238" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.35" x="84" y="238" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.13" x="98" y="238" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.55" x="112" y="238" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.83" x="126" y="238" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.86" x="140" y="238" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.63" x="154" y="238" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.38" x="168" y="238" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.57" x="182" y="238" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.13" x="196" y="238" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.9" y="252" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.63" x="14" y="252" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.23" x="28" y="252" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.56" x="42" y="252" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.38" x="56" y="252" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.19" x="70" y="252" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.29" x="84" y="252" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.78" x="98" y="252" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.14" x="112" y="252" width="6" height="6" fill="#BCBBBB" />
                          <rect opacity="0.64" x="126" y="252" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.27" x="140" y="252" width="6" height="6" fill="#CFCECD" />
                          <rect opacity="0.85" x="154" y="252" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.02" x="168" y="252" width="6" height="6" fill="#DAD9D9" />
                          <rect opacity="0.29" x="182" y="252" width="6" height="6" fill="#8E8B8B" />
                          <rect opacity="0.4" x="196" y="252" width="6" height="6" fill="#8E8B8B" />
                        </g>
                      </g>
                      <defs>
                        <clipPath id="clip0_236_15557">
                          <rect width="205" height="264" fill="white" />
                        </clipPath>
                        <clipPath id="clip1_236_15557">
                          <rect width="236" height="264" fill="white" transform="translate(-0.164062)" />
                        </clipPath>
                      </defs>
                    </svg>
                  </div>
                  <span>
                    <figure>{i18n.t("common.figure", { n: 2 })}</figure> <strong>{config.stats.contributors}</strong>{" "}
                    {i18n.t("home.growth.contributors")}
                  </span>
                </div>

                <div data-component="growth-stat">
                  <div data-component="stat-illustration">
                    <svg width="205" height="264" viewBox="0 0 205 264" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <g opacity="0.5">
                        <path d="M205 0H203.985V264H205V0Z" fill="#8E8B8B" />
                        <path d="M197.896 34H196.881V264H197.896V34Z" fill="#8E8B8B" />
                        <path d="M189.777 26H188.762V264H189.777V26Z" fill="#8E8B8B" />
                        <path d="M183.688 52H182.673V264H183.688V52Z" fill="#8E8B8B" />
                        <path d="M176.584 0H175.569V264H176.584V0Z" fill="#8E8B8B" />
                        <path d="M169.48 29H168.465V264H169.48V29Z" fill="#8E8B8B" />
                        <path d="M162.376 44H161.361V264H162.376V44Z" fill="#8E8B8B" />
                        <path d="M155.272 65H154.257V264H155.272V65Z" fill="#8E8B8B" />
                        <path d="M149.183 29H148.168V264H149.183V29Z" fill="#8E8B8B" />
                        <path d="M142.079 36H141.064V264H142.079V36Z" fill="#8E8B8B" />
                        <path d="M134.975 48H133.96V264H134.975V48Z" fill="#8E8B8B" />
                        <path d="M127.871 7H126.856V264H127.871V7Z" fill="#8E8B8B" />
                        <path d="M120.767 0H119.752V264H120.767V0Z" fill="#8E8B8B" />
                        <path d="M113.663 14H112.649V264H113.663V14Z" fill="#8E8B8B" />
                        <path d="M106.559 27H105.545V264H106.559V27Z" fill="#8E8B8B" />
                        <path d="M99.4554 70H98.4406V264H99.4554V70Z" fill="#8E8B8B" />
                        <path d="M92.3515 32H91.3366V264H92.3515V32Z" fill="#8E8B8B" />
                        <path d="M85.2475 35H84.2327V264H85.2475V35Z" fill="#8E8B8B" />
                        <path d="M78.1436 36H77.1287V264H78.1436V36Z" fill="#8E8B8B" />
                        <path d="M71.0396 10H70.0248V264H71.0396V10Z" fill="#8E8B8B" />
                        <path d="M63.9356 42H62.9208V264H63.9356V42Z" fill="#8E8B8B" />
                        <path d="M56.8317 43H55.8168V264H56.8317V43Z" fill="#8E8B8B" />
                        <path d="M49.7277 38H48.7129V264H49.7277V38Z" fill="#8E8B8B" />
                        <path d="M42.6238 56H41.6089V264H42.6238V56Z" fill="#8E8B8B" />
                        <path d="M36.5347 36H35.5198V264H36.5347V36Z" fill="#8E8B8B" />
                        <path d="M29.4307 8H28.4158V264H29.4307V8Z" fill="#8E8B8B" />
                        <path d="M22.3267 20H21.3119V264H22.3267V20Z" fill="#8E8B8B" />
                        <path d="M15.2228 1H14.2079V264H15.2228V1Z" fill="#8E8B8B" />
                        <path d="M8.11881 9H7.10396V264H8.11881V9Z" fill="#8E8B8B" />
                        <path d="M1.01485 31H0V264H1.01485V31Z" fill="#8E8B8B" />
                      </g>
                    </svg>
                  </div>
                  <span>
                    <figure>{i18n.t("common.figure", { n: 3 })}</figure> <strong>{config.stats.monthlyUsers}</strong>{" "}
                    {i18n.t("home.growth.monthlyDevs")}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section data-component="privacy">
            <div data-slot="privacy-title">
              <h3>{i18n.t("home.privacy.title")}</h3>
              <div>
                <span>[*]</span>

                <p>
                  {i18n.t("home.privacy.body")} {i18n.t("home.privacy.learnMore")}{" "}
                  <a href={language.route("/docs/enterprise/")}>{i18n.t("home.privacy.link")}</a>.
                </p>
              </div>
            </div>
          </section>

          <section data-component="faq">
            <div data-slot="section-title">
              <h3>{i18n.t("common.faq")}</h3>
            </div>
            <ul>
              <li>
                <Faq question={i18n.t("home.faq.q1")}>{i18n.t("home.faq.a1")}</Faq>
              </li>
              <li>
                <Faq question={i18n.t("home.faq.q2")}>
                  {i18n.t("home.faq.a2.before")} <a href={language.route("/docs")}>{i18n.t("home.faq.a2.link")}</a>.
                </Faq>
              </li>
              <li>
                <Faq question={i18n.t("home.faq.q3")}>
                  {i18n.t("home.faq.a3.p1")} {i18n.t("home.faq.a3.p4.beforeLocal")}{" "}
                  <a href={language.route("/docs/providers/#lm-studio")} target="_blank">
                    {i18n.t("home.faq.a3.p4.localLink")}
                  </a>
                  .
                </Faq>
              </li>
              <li>
                <Faq question={i18n.t("home.faq.q4")}>
                  {i18n.t("home.faq.a4.p1")}{" "}
                  <a href={language.route("/docs/providers/#directory")}>{i18n.t("common.learnMore")}</a>.
                </Faq>
              </li>
              <li>
                <Faq question={i18n.t("home.faq.q5")}>
                  {i18n.t("home.faq.a5.beforeDesktop")}{" "}
                  <a href={language.route("/download")}>{i18n.t("home.faq.a5.desktop")}</a> {i18n.t("home.faq.a5.and")}{" "}
                  <a href={language.route("/docs/web")}>{i18n.t("home.faq.a5.web")}</a>!
                </Faq>
              </li>
              <li>
                <Faq question={i18n.t("home.faq.q6")}>{i18n.t("home.faq.a6")}</Faq>
              </li>
              <li>
                <Faq question={i18n.t("home.faq.q7")}>
                  {i18n.t("home.faq.a7.p1")} {i18n.t("home.faq.a7.p2.beforeShare")}{" "}
                  <a href={language.route("/docs/share/#privacy")}>{i18n.t("home.faq.a7.p2.shareLink")}</a>.
                </Faq>
              </li>
              <li>
                <Faq question={i18n.t("home.faq.q8")}>
                  {i18n.t("home.faq.a8.p1")}{" "}
                  <a href={config.github.repoUrl} target="_blank">
                    {i18n.t("nav.github")}
                  </a>{" "}
                  {i18n.t("home.faq.a8.p2")}{" "}
                  <a href={`${config.github.repoUrl}?tab=MIT-1-ov-file#readme`} target="_blank">
                    {i18n.t("home.faq.a8.mitLicense")}
                  </a>
                  {i18n.t("home.faq.a8.p3")}
                </Faq>
              </li>
            </ul>
          </section>

          <EmailSignup />

          <Footer />
        </div>
      </div>
      <Legal />
    </main>
  )
}
