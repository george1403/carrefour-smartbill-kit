# Facturi SmartBill din comenzile Carrefour — ghid de pornire

**De ce ai nevoie:** un calculator cu Windows sau Mac, internet, contul SmartBill (email + parola) si contul **firmei tale** din portalul de furnizori Carrefour (utilizator + parola).

**Totul se face cu dublu-click si alegand un numar din meniu.** Nu trebuie sa scrii nicio comanda si nu trebuie sa deschizi alte programe.

## 1. Descarca si dezarhiveaza
1. Descarca fisierul ZIP primit (de ex. **carrefour-smartbill-kit-WINDOWS.zip** sau **-MAC.zip**).
2. **Windows:** click dreapta pe el → **Extrage tot** → **Extragere**. **Mac:** dublu-click pe el.
3. Muta folderul obtinut in **Documente**. Evita folderele sincronizate (OneDrive/iCloud) daca se poate.

## 2. Instaleaza (o singura data, 5–10 minute)
**Windows:** dublu-click pe **install.bat**.
- Daca apare fereastra albastra „Windows a protejat PC-ul”: click pe **Mai multe informatii** → **Executare oricum**.

**Mac:** dublu-click pe **install.command**.
- Daca apare „nu poate fi deschis / dezvoltator neidentificat”: apasa **OK** (sau **Terminat**), deschide  → **Setari sistem** → **Confidentialitate si securitate**, coboara pana la mesajul despre *install.command* si apasa **Deschide oricum**, apoi **Deschide** (poate cere parola calculatorului).
- Pe Mac-uri mai vechi merge si: click dreapta pe **install.command** → **Deschide** → **Deschide**.

Programul isi descarca singur tot ce ii trebuie si scrie **Instalare reusita**. Tot el:
- scoate „avertismentul de internet” de pe fisierele programului (data viitoare merge direct dublu-click);
- pune pe **Desktop** scurtatura **Carrefour SmartBill** — de acum o folosesti pe ea ca sa deschizi meniul.

## 3. Raspunde la intrebari
1. Emailul SmartBill  2. Parola SmartBill  3. Utilizatorul Carrefour  4. Parola Carrefour

- **Alegi seria de facturi** scriind numarul ei din lista.
- Programul iti arata **furnizorul si codul de furnizor** citite din portalul Carrefour. Raspunde *da* doar daca e firma ta.
- Daca portalul cere un cod din imagine, se deschide o fereastra: scrie codul si apasa *Autentificare*.

Parolele raman doar pe calculatorul tau; nu le trimite nimanui.

## 4. Alege cum lucreaza
- **1 = doar ciorne** (recomandat la inceput): programul pregateste facturile ca **ciorne** in SmartBill; tu le verifici si apesi *Emite*.
- **2 = automat**: programul emite singur factura pentru fiecare comanda noua.

Poti cere sa verifice singur comenzile **la fiecare ora** (raspunde *da*; poti schimba oricand cu optiunea **11**). Comenzile mai vechi decat ziua instalarii nu se factureaza automat. O comanda deja facturata, deja in ciorna sau cu factura ANULATA nu se mai face a doua oara.

## 5. Meniul
Dublu-click pe scurtatura **Carrefour SmartBill** de pe Desktop (sau pe **run.bat** / **run.command** din folder). Scrii **numarul** optiunii si apesi **Enter**.

| Nr | Ce face |
|---|---|
| 1 | Vezi comenzile Carrefour (noi / deja facturate) |
| 2 | Fa CIORNA pentru o comanda (iti cere numarul comenzii) |
| 3 | Previzualizare comanda (nu salveaza nimic) |
| 4 | Verificare automata acum |
| **5** | **Autentificare Carrefour** (codul din imagine) |
| 6 | Configurare (conturi, serie, mod de lucru) |
| 7 | Verificare instalare |
| 8 | Actualizare: preia conturile si setarile din kitul vechi |
| **9** | **Ciorne in bloc** — toate comenzile nefacturate |
| 10 | Ciorne in bloc — DOAR LISTA (nu creeaza nimic) |
| 11 | Verificare automata la fiecare ora: porneste / opreste |
| 12 | Reciteste datele din SmartBill si Carrefour (serii, produse, magazine) |
| **13** | **Trimite raport la suport** |
| 14 | Reparare instalare |
| 15 | Dezinstalare |
| 0 | Iesire |

Cat timp programul lucreaza scrie **LUCREZ...** — nu inchide fereastra. La final scrie **GATA** (verde) sau **NU S-A TERMINAT** (rosu, cu pasii de urmat). Apoi apasa **Enter** ca sa revii la meniu.

### Optiunea 9 — Ciorne in bloc (toate comenzile nefacturate)
Face **ciorne** pentru **TOATE** comenzile din portal care nu sunt inca facturate, **oricat de vechi**.

1. Programul citeste portalul si iti arata **lista**: cate comenzi, totalul fara TVA, cele care **au deja ciorna** (nu se fac a doua oara) si cele **sarite**, fiecare cu motivul.
2. Te intreaba (cu galben): **Scrie da si apasa Enter**. Orice alt raspuns = nu se creeaza nimic.
3. Le face pe toate, singur, **in loturi de cate 10**, verificand inainte de fiecare ca nu exista deja factura sau ciorna.
4. La final: **raport** cu ciornele create, cele care aveau deja ciorna, cele sarite si erorile.

Face **numai ciorne**, chiar daca ai ales modul *automat*: **nu emite nicio factura**. Tu le verifici si le emiti din SmartBill > Ciorne.
Vrei doar sa vezi lista, fara sa se creeze nimic? Alege **10**.
Daca portalul cere autentificarea, programul te intreaba daca deschide fereastra (scrie **da**), apoi reia singur. O rulare oprita se poate relua oricand — ce e deja facut nu se dubleaza.

## 6. Codul din imagine (CAPTCHA) si sesiunea Carrefour
Programul tine minte autentificarea. Cand portalul cere din nou codul:
- daca **esti la calculator**, programul te intreaba „Deschid acum fereastra de autentificare?” — scrie **da**. Rezolva codul (sau bifa „nu sunt robot”) si apasa *Autentificare*. Fereastra se inchide singura si programul **continua**.
- in **verificarea automata** (cand nu esti la calculator), programul se opreste, iti arata o notificare si scrie fisierul **ATENTIE-autentificare-Carrefour.txt** in folder. Deschide meniul si alege **5**.

Programul nu reincearca o parola gresita (ca sa nu se blocheze contul).

## 7. Daca ceva nu merge
Orice problema afiseaza, cu rosu, o caseta **CE FACI** cu pasi numerotati si numarul din meniu de ales. Cele mai dese:
- *alege 5* — autentificare Carrefour;
- *alege 6* — parola schimbata, serie disparuta, configurare stricata;
- *alege 14* — lipseste o parte din instalare (programul te intreaba si singur daca o repara);
- *verifica internetul* si incearca din nou.

**Daca nu reusesti:** alege **13 (Trimite raport la suport)**. Programul face UN singur fisier **RAPORT-SUPORT-<data>.zip** in folderul programului si deschide fereastra cu el selectat. **Trimite acest fisier lui George pe WhatsApp sau email.** Fisierul NU contine parolele tale.

## 8. Actualizare la o versiune noua (fara sa pierzi nimic)
1. Dezarhiveaza ZIP-ul nou langa cel vechi (poate iesi un folder „carrefour-smartbill-kit 2” — e in regula).
2. Dublu-click pe **install** din folderul nou: preia singur conturile, setarile si jurnalul comenzilor din kitul vechi (daca nu le-a gasit, alege **8** din meniu).
3. Daca aveai verificarea la fiecare ora, programul o muta singur pe folderul nou, iar scurtatura de pe Desktop arata spre folderul nou.
4. Kitul vechi ramane neatins; dupa ce vezi ca totul merge, il poti sterge.

## 9. Dezinstalare
Alege **15** si scrie **da**: opreste verificarea automata si sterge scurtatura de pe Desktop. Apoi trage folderul programului in **Cos** (Mac) / **Recycle Bin** (Windows).

**Atentie:** daca in SmartBill e pornita *trimiterea automata in SPV*, facturile emise pleaca singure la ANAF. Programul te avertizeaza la configurare si nu schimba aceasta setare.
