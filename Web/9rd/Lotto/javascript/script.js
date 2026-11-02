// 생성된 추천 번호 6개를 표시하는 영역입니다.
const numbersContainer = document.querySelector("#numbers");

// 번호 생성 버튼과 초기화 버튼입니다.
const drawButton = document.querySelector("#draw-button");
const resetButton = document.querySelector("#reset-button");

// 분석 진행 상황과 번호 출현 빈도를 표시하는 화면 요소입니다.
const analysisStatus = document.querySelector("#analysis-status");
const frequencyList = document.querySelector("#frequency-list");
const drawCountText = document.querySelector("#draw-count");

// 한 번 불러온 당첨 기록은 페이지가 열린 동안 재사용합니다.
let recentDraws = null;

// 사용자가 번호 뽑기를 누른 횟수입니다.
let drawCount = 0;

// 동행복권 공식 API에서 당첨 회차를 가져와 본번호 6개를 확인합니다.
async function getDraw(round) {
  const url = round === null
    ? "https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do"
    : `https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=${round}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`공식 당첨 기록 요청 실패 (HTTP ${response.status})`);
  }

  const result = await response.json();
  const draw = result.data?.list?.[0];
  if (!draw || (round !== null && draw.ltEpsd !== round)) {
    throw new Error(`${round === null ? "최신" : `${round}회`} 당첨 기록을 찾을 수 없습니다.`);
  }

  const numbers = [draw.tm1WnNo, draw.tm2WnNo, draw.tm3WnNo, draw.tm4WnNo, draw.tm5WnNo, draw.tm6WnNo];
  if (numbers.some((number) => !Number.isInteger(number) || number < 1 || number > 45) ||
      new Set(numbers).size !== 6) {
    throw new Error(`${draw.ltEpsd}회 당첨번호 데이터가 올바르지 않습니다.`);
  }

  return { round: draw.ltEpsd, numbers };
}

// 최신 회차를 확인한 후 해당 회차부터 과거 300회까지의 기록을 가져옵니다.
async function loadRecentDraws() {
  const latestDraw = await getDraw(null);
  const firstRound = latestDraw.round - 299;
  const draws = [latestDraw];

  // 공식 서버에 한꺼번에 과도한 요청을 보내지 않도록 10회차씩 가져옵니다.
  for (let startRound = firstRound; startRound <= latestDraw.round - 1; startRound += 10) {
    const endRound = Math.min(startRound + 9, latestDraw.round - 1);
    const roundNumbers = Array.from(
      { length: endRound - startRound + 1 },
      (_, index) => startRound + index
    );
    const batch = await Promise.all(roundNumbers.map((round) => getDraw(round)));
    draws.push(...batch);
    analysisStatus.textContent = `최근 300회 당첨 기록 분석 중 (${draws.length}/300회)...`;
  }

  if (draws.length !== 300) {
    throw new Error(`당첨 기록이 300회 모두 수집되지 않았습니다 (${draws.length}/300).`);
  }
  return draws;
}

// 최근 300회 동안 각 번호가 본번호로 나온 횟수를 계산합니다.
function countNumberFrequencies(draws) {
  const frequencies = Array(46).fill(0);
  draws.forEach((draw) => {
    draw.numbers.forEach((number) => {
      frequencies[number] += 1;
    });
  });
  return frequencies;
}

// 출현 횟수가 많을수록 뽑힐 가중치를 높여, 중복 없이 번호 6개를 추천합니다.
function makeWeightedNumbers(frequencies) {
  const numberPool = Array.from({ length: 45 }, (_, index) => index + 1);
  const selectedNumbers = [];

  while (selectedNumbers.length < 6) {
    const totalWeight = numberPool.reduce((sum, number) => sum + frequencies[number], 0);
    let randomWeight = Math.random() * totalWeight;

    for (let index = 0; index < numberPool.length; index += 1) {
      randomWeight -= frequencies[numberPool[index]];
      if (randomWeight < 0) {
        selectedNumbers.push(numberPool.splice(index, 1)[0]);
        break;
      }
    }
  }

  return selectedNumbers.sort((first, second) => first - second);
}

// 번호 목록을 공 모양으로 표시합니다.
function showNumbers(container, numbers, className, label) {
  container.replaceChildren();
  numbers.forEach((number) => {
    const numberElement = document.createElement("span");
    numberElement.className = className;
    numberElement.textContent = label(number);
    container.append(numberElement);
  });
}

// 1부터 45까지 모든 번호의 출현 횟수와 300회 중 출현 비율을 표시합니다.
function showNumberFrequencies(frequencies) {
  frequencyList.replaceChildren();
  const highestFrequency = Math.max(...frequencies.slice(1));

  for (let number = 1; number <= 45; number += 1) {
    const frequencyItem = document.createElement("div");
    const numberLabel = document.createElement("strong");
    const barTrack = document.createElement("div");
    const bar = document.createElement("div");
    const frequencyLabel = document.createElement("span");
    const percentage = (frequencies[number] / recentDraws.length * 100).toFixed(2);

    frequencyItem.className = "frequency-item";
    numberLabel.className = "frequency-number";
    barTrack.className = "frequency-track";
    bar.className = "frequency-bar";
    frequencyLabel.className = "frequency-value";
    numberLabel.textContent = `${number}번`;
    frequencyLabel.textContent = `${frequencies[number]}회 · ${percentage}%`;
    bar.style.width = `${frequencies[number] / highestFrequency * 100}%`;
    barTrack.setAttribute("aria-label", `${number}번, ${frequencies[number]}회 출현, ${percentage}%`);
    barTrack.append(bar);
    frequencyItem.append(numberLabel, barTrack, frequencyLabel);
    frequencyList.append(frequencyItem);
  }
}

// 번호 뽑기 버튼을 누르면 공식 기록을 분석한 다음 가중 추천 번호를 표시합니다.
drawButton.addEventListener("click", async () => {
  drawButton.disabled = true;
  resetButton.disabled = true;
  analysisStatus.textContent = "동행복권 최신 당첨 기록을 확인하는 중...";

  try {
    recentDraws ??= await loadRecentDraws();
    const frequencies = countNumberFrequencies(recentDraws);
    showNumberFrequencies(frequencies);
    showNumbers(numbersContainer, makeWeightedNumbers(frequencies), "number-ball", String);
    const latestRound = Math.max(...recentDraws.map((draw) => draw.round));
    analysisStatus.textContent = `${latestRound - 299}회부터 ${latestRound}회까지, 최근 300회 본번호 분석 결과입니다.`;
    drawCount += 1;
    drawCountText.textContent = `생성 횟수: ${drawCount}회`;
  } catch (error) {
    console.error("로또 당첨 기록 분석에 실패했습니다.", error);
    analysisStatus.textContent = `분석에 실패했습니다: ${error.message} 인터넷 연결을 확인하고 다시 눌러주세요.`;
  } finally {
    drawButton.disabled = false;
    resetButton.disabled = false;
  }
});

// 초기화 버튼을 눌렀을 때 표시 중인 번호와 생성 횟수를 초기화합니다.
resetButton.addEventListener("click", () => {
  numbersContainer.innerHTML = '<span class="placeholder">번호 뽑기를 눌러 분석을 시작하세요</span>';
  drawCount = 0;
  drawCountText.textContent = "생성 횟수: 0회";
});
