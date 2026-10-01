// ==UserScript==
// @name         Simplifi
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Custom enhancements for Quicken Simplifi (Account sorting & Investment pie chart visualization)
// @author       tjipz8
// @match        https://simplifi.quicken.com/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @updateURL    https://raw.githubusercontent.com/tjipz8/simplifi/main/simplifi.user.js
// @downloadURL  https://raw.githubusercontent.com/tjipz8/simplifi/main/simplifi.user.js
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    console.log('start tempermonkey simplifi');

    function convertCurrency(a) {
        return Number(a.replace(/[^0-9\.-]+/g,""));
    }

    function sortAccountOverview() {
        let div = document.querySelectorAll('.MuiCollapse-vertical.MuiCollapse-entered>div>div');
        div.forEach(function(curr, idx) {
            if(idx != 0 && idx != 4)
            {
                let a = curr.childNodes;
                let aSorted = [].slice.call(a).sort(function (b, c) {
                    let x = convertCurrency(b.querySelector('span[data-testid="amount-field"]').textContent);
                    let y = convertCurrency(c.querySelector('span[data-testid="amount-field"]').textContent);
                    let name1 = b.textContent.split('$')[0];
                    let name2 = c.textContent.split('$')[0];
                    if(x == y) {
                        return name1 > name2 ? 1 : -1;
                    }
                    else {
                        return x < y ? 1 : -1;
                    }
                });
                curr.replaceChildren(...aSorted);
            }
        });
        console.log('sorted');
    };

    let totalAmount=0;
    // listen for changes
    setInterval(function()
                {
        let element = document.querySelector('#qCard-account-list');
        if(element) {
            sortAccountOverview();
        }
        if(window.location.href.includes('settings/accounts')) {
            document.querySelector("h2").textContent = `Accounts (${document.querySelectorAll("li[class*=MuiListItem-root]").length})`
        }
        let newtotalAmount = document.querySelector("#totals [data-testid*='amount'], #totals [data-testid*='Amount'], span[sharedcomponentid='AmountField']")?.textContent;
        if(window.location.href.includes('/investing') && newtotalAmount && newtotalAmount != totalAmount ) {

            totalAmount = newtotalAmount;

            var isAllAccounts = (document.querySelector("#account-select-dropdown") || document.querySelector("#totals button, #totals [role='button']"))?.innerText?.trim() == "All accounts";

            if(window.location.href.includes('selectedTab=balances')) {}
            else {
                let valBtn = document.querySelectorAll("button[field=value]")[0];
                let valBtnSort = valBtn?.querySelectorAll('svg[data-testid=ArrowDownwardIcon]');
                if(valBtnSort && valBtnSort.length == 0) {
                    valBtn.click();
                }
            }

            //return;

            let db;
            const request = indexedDB.open("localforage");
            request.onerror = (event) => {
                console.error("Why didn't you allow my web app to use IndexedDB?!");
            };
            request.onsuccess = (event) => {
                db = event.target.result;
                let req = db.transaction('keyvaluepairs').objectStore('keyvaluepairs').getAllKeys();
                req.onsuccess = ()=> {
                    let req2 = db.transaction('keyvaluepairs').objectStore('keyvaluepairs').getAllRecords();
                    req2.onsuccess = (e)=> {
                        let accounts = JSON.parse(req2.result.filter((k) => k.key.endsWith('accountsStore'))[0].value).data.resourcesById;
                        let totalBankCash = 0;
                        if(isAllAccounts) {
                            totalBankCash = Object.keys(accounts).filter(c => accounts[c].type == "BANK" && accounts[c].currentBalanceAsOf > 0).map(c => accounts[c].currentBalanceAsOf).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
                        }
                        let holdings = JSON.parse(req2.result.filter((k) => k.key.endsWith('investmentHoldingsV2Store'))[0].value).data.resourcesById;

                        GM_xmlhttpRequest({
                            method : "GET",
                            url : "https://www.gstatic.com/charts/loader.js",
                            onload : (ev) =>
                            {
                                let e = document.createElement('script');
                                e.id = 'googlechartscript';
                                e.innerText = ev.responseText;
                                if(!document.querySelector("#googlechartscript")) {
                                    document.head.appendChild(e);
                                    google.charts.load('current', {'packages':['corechart']});
                                    google.charts.setOnLoadCallback(drawChart);
                                } else
                                {
                                    drawChart();
                                }

                                function compareNumbers(a, b) {
                                    return b[1] - a[1];
                                }

                                function drawChart() {
                                    var total = convertCurrency(totalAmount);
                                    var data = [['Symbol','Value']];
                                    var stocks = new Map();
                                    var fundrise = [['FUNDRISE',0]];
                                    var totalcash = [['CASH+SGOV+USDG',totalBankCash]];
                                    var totalmarket = new Map();
                                    var totalbond = new Map();
                                    var source = Object.values(holdings);
                                    const investmentsViewEl = document.querySelector('#investments-view');
                                    const investmentsViewElKey = Object.keys(investmentsViewEl).find(k => k.startsWith('__reactFiber'));
                                    const getFirstEntryValues = (arr) =>
                                    arr.flatMap(item => {
                                        if (item?.entry?.[0]) return item.entry[0];
                                        if (item?.nodes) {
                                            return item.nodes.map(node => node?.entry?.[0]).filter(val => val !== undefined);
                                        }
                                        return [];
                                    });
                                    let selectedAccountsProps = investmentsViewEl[investmentsViewElKey].child.child.child.memoizedProps.accounts._root;
                                    const selectedAccounts = selectedAccountsProps.nodes ? getFirstEntryValues(selectedAccountsProps.nodes) : selectedAccountsProps.entries.map(c => c[0]);
                                    source = source.filter(x=>selectedAccounts.includes(x.accountId));
                                    source.forEach(el => {
                                        if(!el.id) { return; }
                                        let item = [];
                                        let symbol = el.symbol;
                                        let name = el.securityName;
                                        let isCash = (name && name.toLowerCase().includes('cash')) || el.isCash === true;
                                        let isFundrise = (name && (name.includes('Real Estate') || name.includes('REIT')));
                                        let isGodai = !symbol && name == 'Godai';
                                        if(isGodai)
                                        {
                                            symbol = 'GODAI';
                                        }
                                        let amount = isCash || isFundrise || isGodai ? el.marketValue : source.filter(x=>x.symbol==symbol).sort((a,b)=>a.currentPriceAt < b.currentPriceAt ? 1 : -1)[0].currentPrice * el.quantity;
                                        if(amount > 0) {
                                            if(isCash || symbol?.includes('SGOV') || symbol?.includes('USDG') )
                                            {
                                                totalcash[0][1] += amount;
                                            } else if(isFundrise)
                                            {
                                                fundrise[0][1] += amount;
                                            } else if(symbol?.includes('VTSAX') || symbol?.includes('VTI') || symbol?.includes('SCHB') || symbol?.includes('VT') || symbol?.includes('SPYM'))
                                            {
                                                totalmarket.set(symbol,totalmarket.has(symbol) ? totalmarket.get(symbol)+amount : amount);
                                            } else if(symbol?.includes('AGG') || symbol?.includes('BNDX'))
                                            {
                                                totalbond.set(symbol,totalbond.has(symbol) ? totalbond.get(symbol)+amount : amount);
                                            }
                                            else {
                                                if(symbol)
                                                {
                                                  item.push(symbol);
                                                  item.push(amount);
                                                  if(stocks.has(symbol))
                                                  {
                                                      let vv = stocks.get(symbol);
                                                      vv[1] += amount;
                                                      stocks.set(symbol,vv);
                                                  }
                                                  else
                                                  {
                                                      stocks.set(symbol,item);
                                                  }
                                                }
                                            }
                                        }
                                    });
                                    stocks = Array.from(stocks.values());
                                    totalmarket = [[Array.from(totalmarket.keys()).join('+'),totalmarket.values().reduce((acc, val) => acc + val, 0)]];
                                    totalbond = [[Array.from(totalbond.keys()).join('+'),totalbond.values().reduce((acc, val) => acc + val, 0)]];
                                    data = data.concat(stocks.concat(fundrise,totalmarket,totalbond,totalcash).sort(compareNumbers));
                                    const totalSum = data.slice(1).reduce((accumulator, currentValue) => {return accumulator + currentValue[1];}, 0);

                                    console.log(data);
                                    let chartDiv = document.createElement('div');
                                    chartDiv.id = 'piechart';
                                    chartDiv.style.height = '300px';
                                    chartDiv.style['margin-bottom'] = '24px';
                                    if(!document.getElementById('piechart')) {
                                        document.querySelector("#totals").after(chartDiv);
                                    }
                                    let options = {
                                        backgroundColor: "rgb(34, 38, 42)",
                                        legend: {
                                            textStyle: {
                                                color: "white"
                                            },
                                            position: 'right',
                                        },
                                        chartArea: {
                                            width: "85%", // Increases chart width to bring it closer to the legend
                                            height: "90%" // Increases chart height
                                        }
                                    }

                                    //add value to legend
                                    data.forEach(el => {el[0] = `${el[0]} ${new Intl.NumberFormat('en-US', {style: 'currency',currency: 'USD',}).format(el[1])} ${(el[1]/totalSum*100).toFixed(1)}%`});

                                    var _data = google.visualization.arrayToDataTable(data);
                                    let chart = new google.visualization.PieChart(document.getElementById('piechart'));
                                    chart.draw(_data,options);
                                }
                            }
                        });
                    }
                }
            };
        }
    }, 1000) ;

})();
