# Facturi SmartBill din comenzile Carrefour — ghid de pornire

*Kit pentru producătorii artizani de facturare automată portal Carrefour → SmartBill*

**De ce ai nevoie:** un calculator cu Windows sau Mac, internet, contul SmartBill (email + parola) si contul **firmei tale** din portalul de furnizori Carrefour (utilizator + parola).

**Totul se face cu dublu-click si cu butoane mari.** Programul se deschide **in browser** (Chrome, Edge sau Safari) si arata **la fel pe Windows si pe Mac**. Nu trebuie sa scrii nicio comanda.

**Incepe cu videoclipul scurt:** in folderul *Tutorial* din arhiva, priveste intai **00_PREZENTARE_RAPIDA.mp4** (2 minute). Apoi ai videoclipul de instalare pentru calculatorul tau, videoclipul lung (toate explicatiile) si acest ghid.

**Unde pui folderul programului:** pe **Mac** poti porni instalarea si din Descărcări: programul se copiaza singur in folderul personal (**Acasă**) si iti spune unde. Pe **Windows** in Documente sau in *C:\Users\numele-tau*, nu in OneDrive.

**Windows 11, inainte de orice:** daca **Smart App Control** este pornit, opreste-l: **Start → Securitate Windows → Control aplicatii si browser → Setari Smart App Control → Dezactivat**. Windows te avertizeaza ca nu il mai poti porni din nou fara o resetare a calculatorului: este in regula, confirma. (Instalarea verifica singura si iti spune daca a ramas pornit.)

## 1. Descarca si dezarhiveaza
**Windows (important, altfel instalarea poate fi blocata fara niciun mesaj):**
0. **Smart App Control → Dezactivat** (vezi mai sus), daca este pornit.
1. Descarca **carrefour-smartbill-kit-WINDOWS.zip**.
2. **Click dreapta pe ZIP → Proprietati**. Jos, la *Securitate*, bifeaza **Deblocheaza** → **OK**.
3. Click dreapta pe ZIP → **Extrage tot** → **Extragere**.

**Mac:** descarca **carrefour-smartbill-kit-MAC.zip** si da dublu-click pe el.

Unde pui folderul obtinut:
- **Mac:** oriunde; daca e in Desktop, Documente sau Descărcări, instalarea il **copiaza singura in Acasă** (de acolo macOS lasa verificarea automata sa porneasca) si lasa in folderul vechi o nota. Scurtatura de pe Desktop porneste copia din Acasă.
- **Windows:** in **Documente** (sau direct in *C:\Users\numele-tau*). Daca Documentele tale sunt in **OneDrive**, alege *C:\Users\numele-tau*: OneDrive poate bloca jurnalele facturilor (instalarea te avertizeaza).


## 2. Instaleaza (o singura data, 5–10 minute)
**Windows:** dublu-click pe **install.bat**.
- Daca apare fereastra albastra „Windows a protejat PC-ul”: click pe **Mai multe informatii** → **Executare oricum**.
- Daca nu se intampla nimic sau scrie „INSTALAREA NU S-A TERMINAT”: ai sarit pasul *Deblocheaza* de mai sus. Sterge folderul, fa pasul 2 din capitolul 1 si dezarhiveaza din nou.

**Mac:** dublu-click pe **install.command**.
- **Prima data macOS il blocheaza (normal, o singura data).** Daca apare „nu poate fi deschis / dezvoltator neidentificat”: apasa **OK** (sau **Terminat**), deschide  → **Setari sistem** → **Confidentialitate si securitate**, coboara pana la mesajul despre *install.command* si apasa **Deschide oricum**, apoi **Deschide** (poate cere parola calculatorului).
- Pe Mac-uri mai vechi merge si: click dreapta pe **install.command** → **Deschide** → **Deschide**.

Primul lucru pe care il face instalarea este sa puna pe **Desktop** doua scurtaturi (si scrie in fereastra unde sunt); apoi descarca singura tot ce ii trebuie si scrie **Instalare reusita**:
- **Carrefour SmartBill** — programul (se deschide in browser). Pe aceasta o folosesti mereu.
- **Carrefour SmartBill - Meniu text** — vechiul meniu cu numere, doar ca rezerva.

La prima instalare programul se deschide singur la **Configurare**.

Instalarea verifica singura, inainte sa descarce ceva: daca ai pornit-o direct din ZIP (Windows), daca folderul permite scrierea si daca ai cel putin ~1 GB liber pe disc; iti spune in romana ce sa faci. Daca pe acelasi calculator exista deja programul in alt folder (de exemplu al altei firme), scurtatura noua primeste numele folderului in paranteza, ca sa nu o inlocuiasca pe cea veche.

## 3. Ecranul principal
Dublu-click pe **Carrefour SmartBill** de pe Desktop. Se deschide o pagina in browser cu:
- **sus**: firma, seria facturilor, modul de lucru (*doar ciorne* sau *automat*), daca verificarea la fiecare ora e pornita, ultima actiune si **problemele deschise** (fiecare cu butonul care o rezolva);
- **butoanele mari**: Ciornă pentru o comandă · Ciorne în bloc · Autentificare Carrefour · Verificare automată · Istoric · Configurare · Raport suport · Reparare · Dezinstalare.

Cat timp programul lucreaza apare o caseta galbena **LUCREZ… Nu închide fereastra.** La final apare **GATA** (verde) sau o caseta rosie **CE FACI** cu pasii de urmat si un buton care rezolva problema. Programul face **o singura actiune odata**; celelalte butoane asteapta.

Pe Windows, langa ceas apare o fereastra mica, micsorata: e programul. Nu o inchide cat lucrezi. Programul se opreste singur dupa 30 de minute fara folosire sau cu butonul **Închide programul**.

## 4. Configurare
Butonul **Configurare**:
1. Scrii **emailul si parola SmartBill**, **utilizatorul si parola Carrefour** (la a doua configurare poti alege *Folosesc conturile salvate*).
2. Alegi **cum lucreaza** cand verifica singur comenzile noi:
   - **Doar ciorne** (recomandat): pregateste facturile ca **ciorne** in SmartBill; tu le verifici si apesi *Emite*.
   - **Automat**: emite singur factura pentru fiecare comanda noua.
3. Bifezi daca vrei sa **verifice singur la fiecare ora**.
4. Apesi **Pornește configurarea**. Programul citeste SmartBill si portalul si te intreaba pe ecran **ce serie folosesti** (apesi pe ea) si daca **furnizorul** gasit in portal e firma ta (**Da** doar daca e firma ta).

Parolele raman doar pe calculatorul tau si nu apar niciodata pe ecran.

**Ai un kit mai vechi, deja configurat?** In Configurare apasa **Preia setările din kitul vechi**. Programul iti arata folderul gasit; confirma doar daca e **kitul tau**. Nimic nu se preia fara confirmarea ta.

## 5. Ciornă pentru o comandă
Scrii **numarul comenzii Carrefour** (ex. 1780308) si apesi **Fă ciorna**. Factura se salveaza in SmartBill ca **ciorna** (nu se emite). Daca exista deja factura sau ciorna, programul se opreste si scrie **OPRIT, ca să nu faci o dublă**. *Doar previzualizare* completeaza formularul fara sa salveze nimic; *Vezi lista comenzilor* iti arata comenzile din portal.

## 6. Ciorne în bloc (toate comenzile nefacturate) — OPȚIONAL, doar la nevoie
*Aveți nevoie de acest capitol doar dacă aveți comenzi mai vechi, de dinainte de configurare, care încă nu au factură. Dacă toate comenzile vechi sunt facturate, săriți peste el.* Înainte, faceți calibrarea: câteva ciorne una câte una, verificate în SmartBill > **Rapoarte > Facturi > Filtrare > Ciornă** (fără filtru, ciornele nu apar).

1. Apesi **Arată lista**. Programul citeste **toate** comenzile din portal, oricat de vechi, si iti arata un tabel: comanda, data, magazinul, totalul fara TVA, plus cele care **au deja ciornă** si cele **sărite** (cu motiv). **Nu se creeaza nimic.**
2. Apesi **Creează ciornele (N)**. Apare o confirmare: bifezi **Am înțeles** si apesi **Da, creează N ciorne**.
3. Programul le face pe rand, in loturi de cate 10, verificand inainte de fiecare ca nu exista deja factura sau ciorna. La final vezi tabelul cu ciornele create.

Face **numai ciorne**, chiar si in modul *automat*: **nu emite nicio factura**. Le verifici si le emiti din SmartBill > Rapoarte > Facturi > Filtrare > Ciornă.

## 7. Autentificare Carrefour (codul din imagine) — OPȚIONAL, doar la nevoie
*Aveți nevoie de acest capitol doar când programul spune „Portalul Carrefour cere autentificarea” sau când la Probleme deschise apare butonul Autentificare. Dacă nu vedeți niciodată acest mesaj, săriți peste el.*

Cand programul spune „Portalul Carrefour cere autentificarea”, apasa **Autentificare Carrefour** → **Autentifică-mă**. Programul incearca singur codul; daca nu reuseste, se deschide o fereastra a portalului: scrie codul din imagine si apasa *Autentificare*. Fereastra se inchide singura. Daca problema a aparut in timpul altei actiuni, dupa GATA apasa **Reia**.

In verificarea automata (cand nu esti la calculator) programul se opreste, arata o notificare si scrie **ATENTIE-autentificare-Carrefour.txt**; pe ecranul principal apare la *Probleme deschise* cu butonul **Autentificare**. Programul nu reincearca o parola gresita (ca sa nu se blocheze contul).

## 8. Verificare automată
Arata daca verificarea la fiecare ora e **PORNITĂ** sau **OPRITĂ** si ce face in modul ales:
- *doar ciorne*: ciorne pentru comenzile noi (de dupa configurare, cel mult 14 zile vechime), fara dubluri;
- *automat*: prima verificare doar arata ce ar face; apoi cel mult **3 facturi** la o verificare; la orice indoiala se opreste si lasa ciorna; facturile emise apar in **FACTURI-EMISE-AUTOMAT.txt**.

Butoane: **Pornește** / **Oprește** si **Verifică acum, o dată**. Pe Windows verificarea merge si pe baterie si se reia singura dupa somn sau repornire. Daca programul lucreaza deja (de exemplu verificarea automata ruleaza chiar atunci), apasarea unui buton spune **„Programul lucreaza deja”**: asteapta cateva minute si incearca din nou. Daca verificarea nu a mai rulat de peste 3 ore, apare la **Probleme** cu pasii de urmat. Fiecare folder de program are propria verificare: oprirea sau pornirea intr-un folder nu o atinge pe a altui folder.

## 9. Istoric, Raport suport, Reparare — OPȚIONAL, doar la nevoie
*Istoric: doar când vreți să vedeți ce a făcut programul. Raport suport: doar când apare caseta roșie **CE FACI** și pașii din ea nu rezolvă problema. Reparare: doar când programul spune că lipsește browserul sau o parte din instalare.*

- **Istoric**: ultimele actiuni, ciornele facute (cu id-ul din SmartBill), rularile *Ciorne în bloc* si facturile emise automat.
- **Raport suport**: un clic face fisierul **RAPORT-SUPORT-<data>.zip** in folderul programului (FARA parole) si deschide fereastra cu el selectat (**Arată fișierul**). **Trimite-l lui George pe WhatsApp sau email.**
- **Reparare**: descarca din nou browserul programului daca lipseste (*Repară instalarea*) si verifica instalarea.

## 10. Actualizare la o versiune noua (fara sa pierzi nimic)
1. Dezarhiveaza ZIP-ul nou (pe Windows: intai *Deblocheaza*, vezi capitolul 1) si da dublu-click pe **install**.
2. Deschide programul → **Configurare** → **Preia setările din kitul vechi** si confirma folderul vechi.
3. Daca aveai verificarea la fiecare ora: opreste-o in programul vechi si porneste-o in cel nou (**Verificare automată**).
4. Kitul vechi ramane neatins; dupa ce vezi ca totul merge, il poti sterge.

## 11. Dezinstalare — OPȚIONAL, doar dacă nu mai folosiți programul
Butonul **Dezinstalare** → bifezi **Am înțeles** → **Da, dezinstalează**: opreste verificarea automata a acestui folder si sterge scurtaturile de pe Desktop ale acestui folder (scurtaturile altui folder al programului raman). Apoi trage folderul programului in **Cos** (Mac) / **Recycle Bin** (Windows).

## Meniul text (rezerva)
Scurtatura **Carrefour SmartBill - Meniu text** deschide vechiul meniu cu numere (1–15, aceleasi actiuni): scrii numarul optiunii si apesi Enter. 2 = ciorna, 5 = autentificare, 6 = configurare, 8 = preia din kitul vechi (cu confirmare), 9 = ciorne in bloc, 11 = verificare la fiecare ora, 13 = raport suport, 14 = reparare, 15 = dezinstalare.

**Atentie:** daca in SmartBill e pornita *trimiterea automata in SPV*, facturile emise pleaca singure la ANAF. Programul te avertizeaza la configurare si nu schimba aceasta setare.
