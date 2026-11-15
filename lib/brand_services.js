// Service-wise URLs, collected from each brand's own website (15 Nov 2026).
// Only these URLs (plus the brand site/apply/conf links) may appear in a Task Closure mail.
const E = 'https://edwin.co.in';
const EDWIN = {
  'Research Publication': E + '/research-paper', 'DOI & Indexing': E + '/doi-portal',
  'Patent Support (apply)': E + '/apply-for-patent-support', 'Conferences & Events (apply)': E + '/ConferenceApplyNow',
  'Editorial Board Membership': E + '/editorial-board-membership', 'Fellowship (apply)': E + '/apply-for-fellowship',
  'ISSN / Edwin Journal': E + '/edwin-journal', 'Book Publication': E + '/books-publication-services',
  'Journal Help Board / OJS': E + '/journal-help-board', 'Plagiarism & Formatting (apply)': E + '/apply-for-plagiarism-detector',
  'API Calculator (apply)': E + '/apply-for-api-calculator', 'Awards': E + '/awards',
  'Major & Minor Project (apply)': E + '/ApplyForMajorMinorproject', 'Recruitment Services': E + '/help-for-education',
  'University & College': E + '/university-college', 'Apply for Jobs': E + '/apply-for-jobs',
  'Partnership Programme': E + '/partnership-programme', 'Contact': E + '/contact', 'Pay Now': E + '/pay-now',
};
const D = 'https://www.dyaresearch.com';
const DYA = {
  'Upcoming Conference': D + '/upcoming-conference', 'Conference Registration': D + '/upcoming-conference#conference-registration',
  'Become a Speaker': D + '/upcoming-conference#speaker-registration', 'Travel Grant': D + '/upcoming-conference#travel-grant',
  'Fellowship (apply)': D + '/apply-for-fellowship', 'MOOC Supports': D + '/mooc-supports',
  'Writing Assistance (apply)': D + '/apply-now-writing-assistance', 'Faculty & Co-Guide Registration': D + '/faculty-co-guide-registration',
  'Plagiarism Detector (apply)': D + '/apply-for-plagiarism-detector', 'Turnitin Support (apply)': D + '/apply-for-turnitin-support',
  'Major/Minor Project (apply)': D + '/apply-for-major-minor-project', 'Grants (apply)': D + '/apply-for-grants',
  'Journals': D + '/journals', 'Submit Your Paper': D + '/journals/paper-submission',
  'Book Publication (apply)': D + '/book-publication/apply-publication', 'Join Editorial Board': D + '/editorial-board/join-editorial-board',
  'Patent Support (apply)': D + '/patent-support/apply-for-patent-support', 'Legal Services (apply)': D + '/patent-support/apply-for-legal-services',
  'Google Citation & DOI': D + '/patent-support/google-citation-and-dio-number', 'API Calculator': D + '/api-calculator',
  'Launch Your Journal': D + '/launch-journal', 'Print ISSN Support': D + '/print-issn-support',
  'Institutional Services': D + '/institutional-services', 'Digital Library': D + '/digital-library',
  'NGO Support': D + '/ngo-support', 'Business Support': D + '/business-support', 'NAAC Assistance': D + '/naac-assistance',
  'Awards': D + '/awards', 'Contact': D + '/contact', 'Pay Now': D + '/pay-now',
};
const S = 'https://www.samaindia.org';
const SAMA = {
  'SAMA Membership': S + '/membership/sama-membership/', 'One Membership': S + '/membership/one-membership/',
  'Upcoming International Conferences': S + '/conference-awards/upcoming-international-conferences/',
  'Award Ceremony': S + '/conference-awards/award-ceremony/', 'Academic Excellence': S + '/conference-awards/academic-excellence/',
  'Journals': S + '/research/journals/', 'Editorial Board': S + '/research/editorial-board/',
  'Book Publication': S + '/research/book-publication/', 'Submit Paper': S + '/research/submit-paper/',
  'Internship & Training': S + '/internship-training-programmes', 'Contact': S + '/contact/',
};
const U = 'https://www.uscse.com';
const USCSE = {
  'Conference Registration': U + '/conferences/conference-register.php', 'Become a Speaker': U + '/conferences/conference-speaker.php',
  'Conference Awards (apply)': U + '/conferences/conference-awards.php', 'Travel Grant (apply)': U + '/conferences/conference-travel-grant.php',
  'Journals': U + '/academic-services/journals/journals.php', 'Online Paper Submission': U + '/academic-services/form-publication/online-submission.php',
  'Bulk Paper Submission': U + '/academic-services/form-publication/bulk-submission.php', 'Books Publication': U + '/academic-services/books/books.php',
  'Institutional Membership / MOU': U + '/academic-services/institutional-services/institutional-membership.php',
  'Editorial Boards': U + '/academic-services/editorial-board/editorial-board.php',
  'Faculty & Co-Guide Registration': U + '/rnd-ebi/faculty-co-guide-registration.php', 'Major/Minor Project (apply)': U + '/rnd-ebi/apply-major-minor-project.php',
  'Plagiarism Detector (apply)': U + '/rnd-ebi/apply-plagiarism-detector.php', 'Turnitin Support (apply)': U + '/rnd-ebi/apply-turnitin-support.php',
  'Writing Assistance (apply)': U + '/rnd-ebi/apply-writing-assistance.php', 'Patent Support (apply)': U + '/rnd-ebi/apply-patent-support.php',
  'Grants (apply)': U + '/rnd-ebi/apply-grants.php', 'API Calculator (apply)': U + '/rnd-ebi/apply-api-calculator.php',
  'Journal Support': U + '/journal-support/journal-support.php', 'DOI & Indexing Setup': U + '/journal-support/doi-indexing-setup.php',
  'Contact': U + '/contact.php', 'Pay Now': U + '/pay-now.php',
};
const J = 'https://jmajabalpur.org';
const JMA = {
  'JMA Membership (apply)': J + '/membership/jma-membership#applyjma', 'One Membership': J + '/membership/one-membership',
  'Upcoming Conference': J + '/conference/upcoming-conference', 'Journals': J + '/publications/journals',
  'Book Publication': J + '/publications/book-publication', 'Research Paper Submission': J + '/publications/research-paper-submission',
  'Editorial Board Members': J + '/membership/editorial-board-members', 'Fellowship (apply)': J + '/academicians/apply-for-fellowship',
  'MOOC Supports': J + '/academicians/mooc-supports', 'Awards (apply)': J + '/academicians/awards',
  'Faculty & Co-Guide Registration': J + '/rnd-ebi/faculty-co-guide-registration', 'Grants (apply)': J + '/rnd-ebi/apply-for-grants',
  'API Calculator (apply)': J + '/rnd-ebi/apply-for-api-calculator', 'Patent Support (apply)': J + '/rnd-ebi/apply-for-patent-support',
  'Writing Assistance (apply)': J + '/rnd-ebi/apply-now-writing-assistance', 'Major/Minor Project (apply)': J + '/rnd-ebi/apply-for-major-minor-project',
  'Plagiarism Detector (apply)': J + '/rnd-ebi/apply-for-plagiarism-detector', 'Turnitin Support (apply)': J + '/rnd-ebi/apply-for-turnitin-support',
  'Contact': J + '/contact',
};
const C = 'https://www.delhicrestenterprise.com';
const p = (s) => C + '/products/' + s + '/';
const DELHI = {
  'All Products': C + '/products/', 'Contact / Enquire': C + '/contact/', 'Pay Now': C + '/pay-now/', 'Careers': C + '/careers/',
  'Edwin CRM': p('edwin-crm'), 'Edwin Dialer': p('edwin-dialer'), 'WhatsApp Business Portal': p('whatsapp-business-portal'),
  'Delhi Crest Mail': p('delhi-crest-mail'), 'DCE Express': p('dce-express'), 'Social Media Management': p('social-media-management'),
  'HRMS': p('hrms-software'), 'Employee Portal': p('employee-portal'), 'Client Portal': p('client-portal'),
  'Invoice Sender': p('invoice-sender'), 'Letters & Certificate Sender': p('letters-certificate-sender'),
  'Tender Management': p('tender-management'), 'Common AI': p('common-ai'), 'Edwin Creator': p('edwin-creator'),
  'EJMS': p('ejms'), 'JournalFit': p('journalfit'), 'Research Hub': p('research-hub'), 'API Calculator': p('precision-api-calculator'),
  'Project Support': p('project-support-academicians'), 'Edwin University Services': p('edwin-university-services'), 'DCE Tours': p('dce-tours'),
};
module.exports = { 'edwin conference': EDWIN, 'edwin inc': EDWIN, dya: DYA, sama: SAMA, uscse: USCSE, jma: JMA, 'delhi crest': DELHI };
