jest.useFakeTimers();
test('validateChanges', async () => {
    const accountData = { account: 'test' };
    const chargeData = { account: 'test', charges: '5' };
    await fetch('http://localhost:3000/reset', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(accountData)
    });
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const fetchData = async () => {
        return await fetch('http://localhost:3000/charge', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(chargeData)
        })
    };
    const [response1, response2] = await Promise.all([
        fetchData(),
        fetchData()
    ]);
    const response1data = await response1.json();
    const response2data = await response2.json();
    expect(response1data).toEqual({isAuthorized:true, remainingBalance: 95, charges: 5});
    expect(response2data).toEqual({isAuthorized:true, remainingBalance: 90, charges: 5});

    jest.runAllTimers();

    const syncedResponse = await fetchData();
    const syncedResponseData = await syncedResponse.json();
    expect(syncedResponseData).toEqual({isAuthorized:true, remainingBalance: 85, charges:5});
});