import { CvActions, Footer } from "../../_shared";
import type { CvContent } from "../../profile";
import { CvHeader } from "../components/cv-header";
import {
  CvEducation,
  CvExperiences,
  CvIndependentRd,
  CvSection,
  CvSkills,
  CvSummary,
} from "../components/cv-sections";
import { toCvDocument } from "../data/cv-document";

/**
 * The CV page: one column, top to bottom — the header with the contacts, the PDF's download and
 * date when there is a PDF, the summary, the experiences the API selected, the independent R&D,
 * the skills and the education, each section left out when it has nothing to show. It prints as
 * the same document, dark on white, without the download and the footer.
 */
export function CvTemplate({ content }: { readonly content: CvContent }) {
  const cv = toCvDocument(content);
  return (
    <>
      <main className="layout-page flex flex-1 flex-col gap-16 py-12 sm:py-20 print:max-w-none print:gap-8 print:px-0 print:py-0">
        <div className="flex max-w-3xl flex-col gap-6">
          <CvHeader header={cv.header} />
          <CvActions pdf={cv.pdf} withCvLink={false} />
        </div>
        <div className="flex max-w-3xl flex-col gap-16 print:max-w-none print:gap-8">
          <CvSection id="summary" heading="Summary">
            <CvSummary summary={cv.summary} />
          </CvSection>
          {cv.experiences.length === 0 ? null : (
            <CvSection id="experience" heading="Experience">
              <CvExperiences experiences={cv.experiences} />
            </CvSection>
          )}
          {cv.explorations.length === 0 ? null : (
            <CvSection id="independent-rd" heading="Independent R&D">
              <CvIndependentRd explorations={cv.explorations} />
            </CvSection>
          )}
          {cv.skills.length === 0 ? null : (
            <CvSection id="skills" heading="Skills">
              <CvSkills groups={cv.skills} />
            </CvSection>
          )}
          {cv.education.length === 0 ? null : (
            <CvSection id="education" heading="Education">
              <CvEducation rows={cv.education} />
            </CvSection>
          )}
        </div>
      </main>
      <Footer name={cv.header.name} />
    </>
  );
}
