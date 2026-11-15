// Service catalogue, built from each brand's own website + sitemap (15 Nov 2026).
// Each line:  Name | path-or-url | keywords the customer may write (comma separated)
// Used for (1) the only URLs allowed in a Task Closure mail and (2) matching a customer's query to the right service.
// Portal tab "Services (URLs)" can override all of this without touching code.
const mk = (base, lines) => lines.trim().split('\n').map((l) => { const [name, p, kw] = l.split('|').map((x) => x.trim()); return { name, url: /^https?:/.test(p) ? p : base + p, kw: kw || '' }; });

const EDWIN = mk('https://edwin.co.in', `
Research Paper Publication | /research-paper | research paper,paper publication,publish my paper,publish paper,publication,journal publication
Paper Publication Support | /paper-publication-support | paper publication support
Submit / Online Paper | /research-paper | paper submission,submit paper,submit my paper
One Membership | /one-member | one member,membership
DOI Membership | /doi-member | doi member
Professional Membership | /professional-member | professional member
Editorial Board Membership | /editorial-board-membership | editorial board,editorial member,reviewer,peer review,editor
Other Memberships | /membership-others | other membership
Services to Members | /services-to-members | member services,services to members
Institutional Membership | /institutionalMembership | institutional membership,institution membership
Membership Portal | /membership-portal | membership portal
Online Membership Articles Access | /online-membership-articles-accessing | access articles,article access
Book Publication | /books-publication-services | book publication,publish book,book chapter,isbn,book
Fellowship (apply) | /apply-for-fellowship | fellowship,fellow
Patent Registration | /apply-for-patent-registration | patent registration,patent
Patent Support (apply) | /apply-for-patent-support | patent support,patent filing,copyright
MOOC Supports | /mooc-supports | mooc,course creator
Online Learning MOOC | /online-learning-mooc | online learning,online course,certificate course
International Conference (apply) | /apply-for-international-conference |
Conference Apply Now | /ConferenceApplyNow |
Conferences | /conferences |
Academic Institutional Partners | /academic-institutional-partners | institutional partner,academic partner,mou
R&D / EBI | /rnd-ebi | r&d,ebi
Academic Immigration Solutions | /academic-immigration-solutions | immigration,study abroad
Academic Writing Assistance | /academic-writing-assistance | writing assistance,thesis writing,paper writing,writing support,proofreading
Faculty & Co-Guide Registration | /faculty-co-guide-registration | co-guide,co guide,guide registration,faculty registration,research guide
Major & Minor Research Projects | /major-and-minor-research-projects | major project,minor project,research project,project support,call for project
Major/Minor Project (apply) | /ApplyForMajorMinorproject | apply for project
Increase Research Citations | /increase-research-citations | citation,google scholar,h-index,h index
Research Grants | /apply-for-research-grants | grant,funding,research fund
Plagiarism Checker | /apply-for-plagiarism-checker | plagiarism,similarity check,similarity report
Turnitin Support | /apply-for-turnitin-support | turnitin
API Calculator | /apply-for-api-calculator | api calculator,api score,api points,pbas,cas
Educational Services | /educational | educational services
Academic News Channel | /academic-news-channel | news channel,academic news
Apply for News | /apply-for-news | publish news,press release
NGO Support | /ngo-support-services | ngo,12a,80g,darpan
International Educational Tours | /international-educational-tours | educational tour,study tour,international tour
Admission Services | /admission-services | admission
PhD Programmes | /phd-programmes | phd,ph.d,doctoral
PG Programmes | /pg-programmes | pg programme,postgraduate,mba,m.tech
UG Programmes | /ug-programmes | ug programme,undergraduate,bba,b.tech
Help for Education | /help-for-education | education help,recruitment services
University & College Services | /university-college | university,college consultancy,affiliation
NAAC Support (apply) | /apply-for-naac-support | naac
NAAC Assistance | /naac-assistance | naac assistance,nirf,accreditation
HR Support (apply) | /apply-for-hr-support | hr support,recruitment,hiring,faculty recruitment,vacancy
NBA Training Support | /apply-for-nba-training-support | nba,training support
Proceeding Printing Support | /support-for-proceeding-printing | proceeding,proceedings printing
Sponsorship for Organizing Conference | /sponsorship-for-organizing-conference | sponsor,organize conference,organise conference,host conference
Need Resource Person | /need-resource-person | resource person,chief guest,keynote
Advertisement Support | /advertisement-support | advertisement,advertise,promotion
Digital Library | /digital-library | digital library,library,e-library
Editors, NGO & Business | /editors-ngo-business | editors ngo business
Journal Help Board | /journal-help-board | journal help,journal website,ojs,journal management
Opening Journal Services | /opening-journal-services | open journal,start journal,launch journal,new journal,own journal
Indexing Technical Support | /technical-support-for-indexing | indexing,scopus,doaj,web of science,ugc care,abstracting
Print & E-ISSN Allotment | /print-eissn-allotment-support | issn,e-issn,print issn
Free DOI | /free-doi | free doi
Paid DOI (Crossref) | /paid-doi-crossref | crossref,paid doi
DOI Registration Services | /doi-registration-services | doi registration,doi number,doi
DOI Portal | /doi-portal | doi portal
CSR Funding Assistant | /csr-funding-assistant | csr
Services for Business | /services-for-business | business services,business support
Business Automation | /services-for-business-automation | business automation,automation,crm software
Digital Marketing | /digital-marketing-services | digital marketing,seo,social media marketing
Mobile Apps (iOS & Android) | /apps-for-ios-and-android | mobile app,android app,ios app,app development
WhatsApp Services for Business | /whatsapp-services-for-business | whatsapp business,whatsapp api,bulk whatsapp
Smart Calling System | /smart-calling-system | calling system,dialer,call center
HR Support for Business | /hr-support-for-business | hr for business,payroll
Edwin Journal | /edwin-journal | edwin journal
Constructions | /constructions | construction
Awards & Recognition | /awards | award,recognition,excellence award,best researcher
Edwin Software | /edwin-software | software,tools
Formatting Tool | /edwin-software/formatting-tool | formatting,paper formatting,format my paper,journal template
Smart API Calculator | /edwin-software/smart-api-calculator | smart api
Plagiarism Detector (software) | /edwin-software/plagiarism-detector | plagiarism detector
Smart Calling System (software) | /edwin-software/smart-calling-system |
Edwin Creator | /edwin-software/edwin-creator | edwin creator,content creator,ai writer
Edwin Humanizer | /edwin-software/edwin-humanizer | humanize,humanizer,ai detection,ai content,ai remover,ai text
Client Portal | /edwin-software/cpclient-portal | client portal
EJMS Journal Management System | /edwin-software/ejms-journal-management-system | ejms
EJMS for Journals | /ejms-for-journals |
UGC-CARE Journal Verification | /edwin-software/ugc-care-journal-verification | journal verification,verify journal,ugc care list,predatory
ResearchHub Repository | /edwin-software/researchhub-repository | researchhub,research hub,repository
Paper Writing Tool | /edwin-software/paper-writing-tool | paper writing tool
Edwin Letters | /edwin-software/edwin-letters | letters,certificate sender
JournalFit | /edwin-software/journalfit | journalfit,journal finder,find journal,which journal
Schedule a Meeting | /apply-schedule-meeting | schedule meeting,schedule a meeting,call back,callback,book a call,consultation
Partnership Programme | /partnership-programme | partnership,partner with,collaborat,associate with
Apply for Jobs | /apply-for-jobs | job,career,work with you
About Us | /about-us |
FAQ | /faq |
Blog | /blog |
Research Guides | /research-guides |
Publication Guides | /publication-guides |
Press | /press |
Gallery | /gallery |
Feedback / Complaint Box | /feedback-complaint-box |
Contact | /contact |
Pay Now | /pay-now |
`);

const DYA = mk('https://www.dyaresearch.com', `
Upcoming Conference | /upcoming-conference |
Conference Registration | /upcoming-conference#conference-registration |
Become a Speaker | /upcoming-conference#speaker-registration | speaker,paper presentation,present paper
Travel Grant | /upcoming-conference#travel-grant | travel grant
Previous Conference | /previous-conference |
Fellowship (apply) | /apply-for-fellowship | fellowship,fellow
MOOC Supports | /mooc-supports | mooc,online course
Register as Course Creator | /mooc-supports#courses | course creator
Register as Student | /mooc-supports#student-form | student registration
HR Support | /hr-support-for-business#form | hr support,recruitment,hiring
Writing Assistance (apply) | /apply-now-writing-assistance | writing assistance,thesis writing,writing support
Faculty & Co-Guide Registration | /faculty-co-guide-registration | co-guide,guide registration
Academic & Immigration Solutions | /dya-academic-immigration-solutions | immigration,study abroad
Plagiarism Detector (apply) | /apply-for-plagiarism-detector | plagiarism,similarity
Turnitin Support (apply) | /apply-for-turnitin-support | turnitin
Major/Minor Project (apply) | /apply-for-major-minor-project | major project,minor project,research project,project support
Grants (apply) | /apply-for-grants | grant,funding
Journals | /journals | journal
Submit Your Paper | /journals/paper-submission | paper submission,submit paper,submit my paper,research paper,publish paper,paper publication
Book Publication (apply) | /book-publication/apply-publication | book publication,publish book,book chapter,book
Editorial Board | /editorial-board |
Join Editorial Board | /editorial-board/join-editorial-board | editorial board,reviewer,editor
Patent Support | /patent-support |
Patent Support (apply) | /patent-support/apply-for-patent-support | patent
Legal Services (apply) | /patent-support/apply-for-legal-services | legal service,legal support
Google Citation & DOI | /patent-support/google-citation-and-dio-number | citation,google scholar,doi
API Calculator | /api-calculator | api calculator,api score
Launch Your Journal | /launch-journal | launch journal,start journal,open journal,own journal,impact factor,indexing
Print ISSN Support | /print-issn-support | issn
Formatting Software | /products/formatting-software | formatting,paper formatting
ResearchHub | /products/researchhub | researchhub,research hub
Journal Verification Portal | /products/journal-verification-portal | journal verification,verify journal
JournalFit | /products/journalfit | journalfit,journal finder,which journal
Institutional Services | /institutional-services | institutional,institution
Digital Library | /digital-library | digital library,library
Journal Help Board | /journal-help-board | journal help,ojs
NGO Support | /ngo-support | ngo
Business Support | /business-support | business support
NAAC Assistance | /naac-assistance | naac,nirf,accreditation
Awards | /awards | award,recognition
Press & Media | /press |
Blog | /blog |
Vision & Mission | /vision |
Our Team | /our-team |
FAQ | /faq |
Contact | /contact |
Pay Now | /pay-now |
`);

const SAMA = mk('https://www.samaindia.org', `
SAMA Membership | /membership/sama-membership/ | membership,member,become a member
One Membership | /membership/one-membership/ | one membership
Upcoming International Conferences | /conference-awards/upcoming-international-conferences/ |
Previous Conferences | /confrences/previous-conferences |
Award Ceremony | /conference-awards/award-ceremony/ | award,recognition
Academic Excellence | /conference-awards/academic-excellence/ | academic excellence,excellence award
Journals | /research/journals/ | journal
Editorial Board | /research/editorial-board/ | editorial board,reviewer,editor
Editorial Board Members | /research/editorial-board-members |
Book Publication | /research/book-publication/ | book publication,publish book,book chapter,book
Submit Paper | /research/submit-paper/ | paper submission,submit paper,submit my paper,research paper,publish paper,paper publication
Internship & Training | /internship-training-programmes | internship,training
Who We Are | /about/who-we-are/ |
Vision & Mission | /about/vision-mission/ |
Blog | /blog |
Press & News | /press-news-update/ |
Donate | /donate/ | donat
FAQ | /faq/ |
Contact | /contact/ |
`);

const USCSE = mk('https://www.uscse.com', `
Conference Registration | /conferences/conference-register.php |
Conference Application | /conferences/conference-application.php |
Become a Speaker | /conferences/conference-speaker.php | speaker,paper presentation,present paper
Conference Awards (apply) | /conferences/conference-awards.php | award,recognition
Travel Grant (apply) | /conferences/conference-travel-grant.php | travel grant
All Conferences | /conferences/conferences.php |
Academic Services | /academic-services/academic-services.php |
Journals | /academic-services/journals/journals.php | journal
Academic Form Publication | /academic-services/form-publication/form-publication.php | form publication
Online Paper Submission | /academic-services/form-publication/online-submission.php | paper submission,submit paper,submit my paper,research paper,publish paper,paper publication
Bulk Paper Submission | /academic-services/form-publication/bulk-submission.php | bulk submission,bulk paper
Books Publication | /academic-services/books/books.php | book publication,publish book,book chapter,book
Academic Support Services | /academic-services/support-services/academic-support-services.php | academic support
HR Services | /academic-services/support-services/hr-services.php | hr service,recruitment,hiring
Awards | /academic-services/support-services/awards.php |
MOOC Support | /academic-services/support-services/mooc-support.php | mooc,online course
Writing Assistance | /academic-services/support-services/writing-assistance.php | writing assistance,thesis writing,writing support
Plagiarism Detector | /academic-services/support-services/plagiarism-detector.php | plagiarism,similarity
API Calculator | /academic-services/support-services/api-calculator.php | api calculator,api score
Digital Library | /academic-services/support-services/digital-library.php | digital library,library
Institutional Services | /academic-services/institutional-services/institutional-services.php | institutional,institution
Institutional Membership / MOU | /academic-services/institutional-services/institutional-membership.php | membership,member,mou
University & College Services | /academic-services/institutional-services/university-college-services.php | university,college
Conference Management Support | /academic-services/institutional-services/conference-management-support.php | organize conference,organise conference,host conference,conference management
Book Supply | /academic-services/institutional-services/book-supply.php | book supply
NGO Support | /academic-services/institutional-services/ngo-support.php | ngo
NAAC Assistance Support | /academic-services/institutional-services/naac-assistance-support.php | naac,nirf,accreditation
Legal Services | /academic-services/legal-services/legal-services.php | legal service,legal support
Editorial Boards | /academic-services/editorial-board/editorial-board.php | editorial board,reviewer,editor
Editorial Board Members | /academic-services/editorial-board/editorial-board-members.php |
Research & Innovation Center | /research-innovation-center/research-center.php | research center
Major & Minor Project | /research-innovation-center/major-minor-project.php | major project,minor project,research project
Patent Support | /research-innovation-center/patent-support.php | patent
Google Scholar Citations | /research-innovation-center/google-scholar-citations.php | citation,google scholar
R&D / EBI | /rnd-ebi/rnd-ebi.php | r&d,ebi
Faculty & Co-Guide Registration | /rnd-ebi/faculty-co-guide-registration.php | co-guide,guide registration
Major/Minor Project (apply) | /rnd-ebi/apply-major-minor-project.php | project support
Plagiarism Detector (apply) | /rnd-ebi/apply-plagiarism-detector.php |
Turnitin Support (apply) | /rnd-ebi/apply-turnitin-support.php | turnitin
Academic & Immigration Solutions | /rnd-ebi/academic-immigration-solutions.php | immigration,study abroad
Writing Assistance (apply) | /rnd-ebi/apply-writing-assistance.php |
Increase Citation & DOI | /rnd-ebi/increase-citation-doi.php | doi
Patent Support (apply) | /rnd-ebi/apply-patent-support.php |
Grants (apply) | /rnd-ebi/apply-grants.php | grant,funding
API Calculator (apply) | /rnd-ebi/apply-api-calculator.php |
Journal Support | /journal-support/journal-support.php | journal support,launch journal,start journal,own journal
Journal Help Board Services | /journal-support/journal-help-board-services.php | journal help,ojs
DOI & Indexing Setup | /journal-support/doi-indexing-setup.php | indexing,scopus,doaj,issn
About | /about.php |
FAQ | /faq.php |
Blog | /blog/blog.php |
Contact | /contact.php |
Pay Now | /pay-now.php |
`);

const JMA = mk('https://jmajabalpur.org', `
JMA Membership (apply) | /membership/jma-membership#applyjma | membership,member,become a member
One Membership | /membership/one-membership | one membership
Upcoming Conference | /conference/upcoming-conference |
Previous Conference | /conference/previous-conference |
Journals | /publications/journals | journal
Book Publication | /publications/book-publication | book publication,publish book,book chapter,book
Book Publication (apply) | /publications/book-publication#ApplyForPublication | apply for publication
Research Paper Submission | /publications/research-paper-submission | paper submission,submit paper,submit my paper,research paper,publish paper,paper publication
Editorial Board Members | /membership/editorial-board-members | editorial board,reviewer,editor
Fellowship (apply) | /academicians/apply-for-fellowship | fellowship,fellow
MOOC Supports | /academicians/mooc-supports | mooc,online course
Register as Course Creator | /academicians/mooc-supports#courses | course creator
Register as Student | /academicians/mooc-supports#student-form | student registration
Awards (apply) | /academicians/awards#award-form | award,recognition
HR Support | /academicians/hr-support#form | hr support,recruitment,hiring
R&D / EBI | /rnd-ebi | r&d,ebi
Faculty & Co-Guide Registration | /rnd-ebi/faculty-co-guide-registration | co-guide,guide registration
Grants (apply) | /rnd-ebi/apply-for-grants | grant,funding
Academic & Immigration Solutions | /rnd-ebi/academic-immigration-solutions | immigration,study abroad
Increase Citation & DOI | /rnd-ebi/increase-citation-doi | citation,doi,google scholar
API Calculator (apply) | /rnd-ebi/apply-for-api-calculator | api calculator,api score
Patent Support (apply) | /rnd-ebi/apply-for-patent-support | patent
Writing Assistance (apply) | /rnd-ebi/apply-now-writing-assistance | writing assistance,thesis writing,writing support
Major/Minor Project (apply) | /rnd-ebi/apply-for-major-minor-project | major project,minor project,research project,project support
Plagiarism Detector (apply) | /rnd-ebi/apply-for-plagiarism-detector | plagiarism,similarity
Turnitin Support (apply) | /rnd-ebi/apply-for-turnitin-support | turnitin
Formatting Software | /products/formatting-software | formatting,paper formatting
ResearchHub | /products/research-hub | researchhub,research hub
Journal Verification Portal | /products/journal-verification-portal | journal verification,verify journal
JournalFit | /products/journalfit | journalfit,journal finder,which journal
Dukhant Service | /services/dukhant-service | dukhant
About Us | /about-us |
Blog | /blog |
Press | /press |
FAQ | /faq |
Contact | /contact |
`);

const DELHI = mk('https://www.delhicrestenterprise.com', `
All Products | /products/ | product,software
Edwin CRM | /products/edwin-crm/ | crm,edwin crm
Edwin Dialer | /products/edwin-dialer/ | dialer
Calling Solution | /products/delhi-crest-calling-solution/ | calling solution,calling software,call center,voip
WhatsApp Business Portal | /products/whatsapp-business-portal/ | whatsapp business,whatsapp api,bulk whatsapp,interakt
Delhi Crest Mail | /products/delhi-crest-mail/ | bulk mail,bulk email,mail merge,email software,mail sender
DCE Express | /products/dce-express/ | dce express,email client
Social Media Management | /products/social-media-management/ | social media management,social media
Data Extractor & List Cleaner | /products/data-extraction-list-cleaner/ | data extract,list cleaner,email list,data cleaning
HRMS | /products/hrms-software/ | hrms,payroll,attendance
DCE Remote | /products/dce-remote/ | remote access,remote desktop
Employee Portal | /products/employee-portal/ | employee portal
Client Portal | /products/client-portal/ | client portal
Invoice Sender | /products/invoice-sender/ | invoice sender,invoice software
Letters & Certificate Sender | /products/letters-certificate-sender/ | certificate sender,letter sender,offer letter
Tender Management | /products/tender-management/ | tender management,tender software
Central Blog Management | /products/central-blog-management/ | blog management,blog software
Common AI | /products/common-ai/ | common ai,chatgpt,gemini,ai subscription,all in one ai,ai tool,ai
AI Remover | /products/ai-remover/ | ai remover,ai detection,ai content
Humanizer | /products/humanizer-tool/ | humanize,humanizer
Edwin Creator | /products/edwin-creator/ | edwin creator,content creator,ai writer
Writing Tool | /products/basic-writing-tool/ | writing tool
Software Formatting | /products/software-formatting/ | formatting,paper formatting,format my paper
EJMS | /products/ejms/ | ejms,journal management system,journal software
JournalFit | /products/journalfit/ | journalfit,which journal
Journal Finder (UGC CARE) | /products/journal-finder-ugc-care/ | journal finder,ugc care,find journal
Research Hub | /products/research-hub/ | researchhub,research hub,repository
Research Paper Writing Tool | /products/research-paper-writing-tool/ | paper writing tool
API Calculator | /products/precision-api-calculator/ | api calculator,api score
Project Support for Academicians | /products/project-support-academicians/ | major project,minor project,project support
Edwin University Services | /products/edwin-university-services/ | university services,naac,affiliation
DCE Tours | /products/dce-tours/ | dce tours,tour,travel,hotel booking
Travel Service | /travel-service/ | travel service
Services | /services/ | services
Editing Services | /services/editing-services/ | editing,proofreading
IT Services | /services/it-services/ | it service,it support
Software Development | /services/software-development/ | software development,custom software,web application
GeM & Tender Support | /services/tender-gem-support/ | gem,tender,government e marketplace
Website Designing | /services/website-designing/ | website,web design,website design,website development
Constructions | /constructions/ | construction
Journals | /journals/ | journal
Research Paper Publication | /research-paper-publication/ | research paper,paper publication,publish paper,paper submission,submit paper
Editorial Board Membership | /editorial-board-membership/ | editorial board,reviewer,editor
Books Publication | /books-publication-services/ | book publication,publish book,book chapter,book
MOOC Supports | /mooc-supports/ | mooc,online course
Fellowship (apply) | /apply-for-fellowship/ | fellowship,fellow
Patent Registration | /apply-for-patent-registration/ | patent
Awards | /awards/ | award,recognition
Conference Apply Now | /conference-apply-now/ |
One Membership | /one-member/ | one member
Professional Membership | /professional-member/ | professional member
DOI Membership | /doi-member/ | doi member
Other Memberships | /membership-others/ | membership,member
Services to Members | /services-to-members/ | member services
Institutional Membership | /institutional-membership/ | institutional membership
Academic Institutional Partners | /academic-institutional-partners/ | institutional partner,mou
Educational | /educational/ | educational
PhD Programmes | /phd-programmes/ | phd,doctoral
PG Programmes | /pg-programmes/ | pg programme,postgraduate,mba
UG Programmes | /ug-programmes/ | ug programme,undergraduate
Online Learning MOOC | /online-learning-mooc/ | online learning
International Educational Tours | /international-educational-tours/ | educational tour,study tour
Academic News Channel | /academic-news-channel/ | news channel
Apply for News | /apply-for-news/ | publish news,press release
NGO Support | /ngo-support/ | ngo
NAAC Support (apply) | /apply-for-naac-support/ | naac
NAAC Assistance | /naac-assistance/ | nirf,accreditation
University & College | /university-college/ | university,college
Educational Services | /educational-services/ | educational services
HR Support (apply) | /apply-for-hr-support/ | hr support,recruitment,hiring
NBA Training Support | /apply-for-nba-training-support/ | nba
Proceeding Printing Support | /support-for-proceeding-printing/ | proceeding
Paper Publication Support | /paper-publication-support/ | publication support
Sponsorship for Organizing Conference | /sponsorship-for-organizing-conference/ | sponsor,organize conference,organise conference
Need Resource Person | /need-resource-person/ | resource person,keynote
Advertisement Support | /advertisement-support/ | advertisement,advertise
Editors, NGO & Business | /editors-ngo-business/ |
Opening Journal Services | /opening-journal-services/ | open journal,start journal,launch journal,own journal
Technical Support for Indexing | /technical-support-for-indexing/ | indexing,scopus,doaj
Print & E-ISSN Allotment | /print-eissn-allotment-support/ | issn
Free DOI | /free-doi/ | free doi
Paid DOI (Crossref) | /paid-doi-crossref/ | crossref,paid doi
DOI Portal | /doi-portal/ | doi
Business Automation | /business-automation/ | automation
Digital Marketing | /digital-marketing/ | digital marketing,seo
CSR Funding Assistant | /csr-funding-assistant/ | csr
WhatsApp Services | /whatsapp-services/ | whatsapp
HR Support for Business | /hr-support-for-business/ | hr for business
Membership Portal | /membership-portal/ | membership portal
Delhi Crest Journal | /delhi-crest-journal/ | delhi crest journal
Delhi Crest Software | /delhi-crest-software/ | delhi crest software
Mobile Apps (iOS & Android) | /apps-for-ios-and-android/ | mobile app,android app,ios app,app development
Services for Business | /services-for-business/ | business services
Digital Library Membership | /membership-dellnett/ | dellnett,digital library
Work Culture | /work-culture/ |
Jagar Journals Support | /jagar-journals-support/ | jagar
Careers | /careers/ | job,career
About | /about/ |
Blog | /blog/ |
Contact / Enquire | /contact/ |
Pay Now | /pay-now/ |
`);

module.exports = { 'edwin conference': EDWIN, 'edwin inc': EDWIN, dya: DYA, sama: SAMA, uscse: USCSE, jma: JMA, 'delhi crest': DELHI };
