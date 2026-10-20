# Facturi SmartBill din comenzile Carrefour — ghid de pornire

**De ce ai nevoie:** un calculator cu Windows sau Mac, internet, contul SmartBill (email + parola) si contul **firmei tale** din portalul de furnizori Carrefour (utilizator + parola).

## 1. Descarca si dezarhiveaza
1. Descarca fisierul **carrefour-smartbill-kit.zip**.
2. Click dreapta pe el → **Extrage tot** (Windows) sau dublu-click (Mac). Muta folderul in **Documente**. Evita folderele sincronizate (OneDrive/iCloud) daca se poate.

## 2. Instaleaza (o singura data, 5–10 minute)
- **Windows:** dublu-click pe **install.bat**. Daca apare „Windows a protejat PC-ul”: *Mai multe informatii* → *Executare oricum*.
- **Mac:** click dreapta pe **install.command** → *Deschide* → *Deschide*.

Programul isi descarca singur tot ce ii trebuie. Nu trebuie sa instalezi nimic altceva.

## 3. Raspunde la intrebari
1. Emailul SmartBill  2. Parola SmartBill  3. Utilizatorul Carrefour  4. Parola Carrefour

- **Alegi seria de facturi** scriind numarul ei din lista (programul nu alege in locul tau cand ai mai multe serii).
- Programul iti arata **furnizorul si codul de furnizor** citite din portalul Carrefour. Raspunde *da* doar daca e firma ta. Daca nu e, se opreste si nu salveaza nimic.

Parolele raman doar pe calculatorul tau (fisierul `.env`); nu le trimite nimanui.

## 4. Alege cum lucreaza
- **1 = doar ciorne** (recomandat la inceput): programul pregateste facturile ca **ciorne** in SmartBill; tu le verifici si apesi *Emite*.
- **2 = automat**: programul emite singur factura pentru fiecare comanda noua.

Poti cere sa verifice singur comenzile **la fiecare ora** (raspunde *da*). Comenzile mai vechi decat ziua instalarii nu se factureaza automat. O comanda deja facturata, deja in ciorna sau cu factura ANULATA nu se mai face a doua oara.
Pe factura, fiecare linie are **exact denumirea din comanda Carrefour** si unitatea ceruta de Carrefour.

## 5. Meniul (dublu-click pe run.bat / run.command)
1 Vezi comenzile · 2 Fa CIORNA · 3 Previzualizare (nu salveaza nimic) · 4 Verificare automata acum · **5 Autentificare Carrefour (CAPTCHA)** · 6 Configurare · 7 Verificare instalare · 8 Actualizare (preia setarile din kitul vechi)

## 6. Codul CAPTCHA si sesiunea Carrefour
Programul tine minte autentificarea. Cand portalul cere din nou codul (sesiunea a expirat sau Carrefour a pus un cod mai greu):

- daca **esti la calculator**, se deschide singura o **fereastra cu portalul**: rezolva codul (sau bifa „nu sunt robot”) si apasa *Autentificare*. Fereastra se inchide singura si programul **continua** ce facea. Ai 10 minute.
- in **verificarea automata** (cand nu esti la calculator), programul se opreste, iti arata o notificare si scrie fisierul **ATENTIE-autentificare-Carrefour.txt** in folderul kitului. Deschide meniul si alege **5**.

Programul nu incearca la nesfarsit si nu reincearca o parola gresita (ca sa nu se blocheze contul).

## 7. Daca ceva nu merge
Fiecare problema are un mesaj **CE FACI**. Cele mai dese: *alege 5* (autentificare Carrefour) · *alege 6* (parola schimbata, serie disparuta, configurare stricata) · *porneste din nou install* (instalare incompleta) · *verifica internetul*. Daca nu e clar, fa o poza ferestrei si trimite-o persoanei de contact.

## 8. Actualizare la o versiune noua (fara sa pierzi nimic)
1. Dezarhiveaza ZIP-ul nou (poate iesi un folder „carrefour-smartbill-kit 2” — e in regula).
2. Porneste **install** din folderul nou: preia singur conturile, setarile si jurnalul comenzilor din kitul vechi (sau alege **8** din meniu).
3. Daca aveai verificarea la fiecare ora, programul o muta singur pe folderul nou. Kitul vechi ramane neatins; il poti arhiva.

**Atentie:** daca in SmartBill e pornita *trimiterea automata in SPV*, facturile emise pleaca singure la ANAF. Programul te avertizeaza la configurare si nu schimba aceasta setare.
